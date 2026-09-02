import { Buffer } from "node:buffer";
import { constants, publicEncrypt } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkXenonAgentTracesAccess,
	checkXenonInferenceAccess,
	fetchXenonTeams,
	loadXenonCliConfig,
	loginXenonAgentTraces,
	loginXenonInference,
} from "../src/core/xenon-inference-auth.js";

function jsonResponse(body: unknown, status: number = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
		},
	});
}

function getUrl(input: string | URL | Request): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.toString();
	}
	return input.url;
}

function getJsonBody(init?: RequestInit): Record<string, unknown> {
	if (typeof init?.body !== "string") {
		throw new Error(`Expected string request body, got ${typeof init?.body}`);
	}
	return JSON.parse(init.body) as Record<string, unknown>;
}

function getAuthorization(init?: RequestInit): string | undefined {
	const headers = init?.headers;
	if (!headers || Array.isArray(headers)) {
		return undefined;
	}
	if (headers instanceof Headers) {
		return headers.get("Authorization") ?? undefined;
	}
	const headerRecord = headers as Record<string, string | undefined>;
	return headerRecord.Authorization ?? headerRecord.authorization;
}

function encryptChallengeResult(publicKey: string, value: string): string {
	return publicEncrypt(
		{
			key: publicKey,
			padding: constants.RSA_PKCS1_OAEP_PADDING,
			oaepHash: "sha256",
		},
		Buffer.from(value, "utf-8"),
	).toString("base64");
}

describe("Xenon Inference auth", () => {
	let tempDir: string;
	let configPath: string;
	let originalTraceBaseUrl: string | undefined;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-xenon-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		configPath = join(tempDir, "config.json");
		originalTraceBaseUrl = process.env.XENON_AGENT_TRACES_BASE_URL;
		delete process.env.XENON_AGENT_TRACES_BASE_URL;
	});

	afterEach(() => {
		if (originalTraceBaseUrl === undefined) {
			delete process.env.XENON_AGENT_TRACES_BASE_URL;
		} else {
			process.env.XENON_AGENT_TRACES_BASE_URL = originalTraceBaseUrl;
		}
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
		vi.restoreAllMocks();
	});

	it("loads Xenon CLI config with defaults", () => {
		writeFileSync(
			configPath,
			JSON.stringify({
				api_key: "xenon-key",
				base_url: "https://xenon-api.example/api/v1",
				frontend_url: "https://xenon-app.example/",
			}),
		);

		expect(loadXenonCliConfig(configPath)).toEqual({
			apiKey: "xenon-key",
			baseUrl: "https://xenon-api.example",
			frontendUrl: "https://xenon-app.example",
			inferenceUrl: "https://api.pinference.ai/api/v1",
			path: configPath,
			teamIdFromEnv: false,
		});
	});

	it("loads Xenon CLI team selection", () => {
		writeFileSync(
			configPath,
			JSON.stringify({
				api_key: "xenon-key",
				team_id: "team-1",
				team_name: "Research",
				team_role: "admin",
			}),
		);

		expect(loadXenonCliConfig(configPath)).toMatchObject({
			apiKey: "xenon-key",
			teamId: "team-1",
			teamName: "Research",
			teamRole: "admin",
			teamIdFromEnv: false,
		});
	});

	it("lets XENON_TEAM_ID override Xenon CLI team selection", () => {
		const originalTeamId = process.env.XENON_TEAM_ID;
		process.env.XENON_TEAM_ID = "env-team";
		writeFileSync(
			configPath,
			JSON.stringify({
				team_id: "file-team",
				team_name: "Research",
				team_role: "admin",
			}),
		);

		try {
			expect(loadXenonCliConfig(configPath)).toMatchObject({
				teamId: "env-team",
				teamIdFromEnv: true,
			});
			expect(loadXenonCliConfig(configPath).teamName).toBeUndefined();
		} finally {
			if (originalTeamId === undefined) {
				delete process.env.XENON_TEAM_ID;
			} else {
				process.env.XENON_TEAM_ID = originalTeamId;
			}
		}
	});

	it("fetches Xenon teams across paginated responses", async () => {
		const requestedUrls: string[] = [];
		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			requestedUrls.push(getUrl(input));
			expect(getAuthorization(init)).toBe("Bearer xenon-key");
			if (requestedUrls.length === 1) {
				return jsonResponse({
					data: [{ teamId: "team-1", name: "Research", slug: "research", role: "admin" }],
					total_count: 2,
				});
			}
			return jsonResponse({
				data: [{ teamId: "team-2", name: "Infra", slug: "infra", role: "member" }],
				total_count: 2,
			});
		});

		await expect(
			fetchXenonTeams("xenon-key", "https://xenon-api.example/api/v1", { fetchFn: fetchMock }),
		).resolves.toEqual([
			{ teamId: "team-1", name: "Research", slug: "research", role: "admin" },
			{ teamId: "team-2", name: "Infra", slug: "infra", role: "member" },
		]);
		expect(requestedUrls).toEqual([
			"https://xenon-api.example/api/v1/user/teams?offset=0&limit=100",
			"https://xenon-api.example/api/v1/user/teams?offset=100&limit=100",
		]);
	});

	it("checks Xenon Inference access with Xenon whoami permissions", async () => {
		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			expect(getUrl(input)).toBe("https://xenon-api.example/api/v1/user/whoami");
			expect(init?.method).toBe("GET");
			expect(getAuthorization(init)).toBe("Bearer xenon-key");
			return jsonResponse({ data: { scope: { inference: { read: true, write: true } } } });
		});

		await expect(
			checkXenonInferenceAccess("xenon-key", "https://xenon-api.example", { fetchFn: fetchMock }),
		).resolves.toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("checks Xenon Agent trace access with Xenon whoami permissions", async () => {
		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			expect(getUrl(input)).toBe("https://xenon-api.example/api/v1/user/whoami");
			expect(init?.method).toBe("GET");
			expect(getAuthorization(init)).toBe("Bearer xenon-key");
			return jsonResponse({ data: { scope: { agent_traces: { read: true, write: true } } } });
		});

		await expect(
			checkXenonAgentTracesAccess("xenon-key", "https://xenon-api.example", { fetchFn: fetchMock }),
		).resolves.toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("validates imported Xenon CLI trace credentials against the production trace API by default", async () => {
		writeFileSync(
			configPath,
			JSON.stringify({
				api_key: "xenon-cli-key",
				base_url: "https://dev-api.example/api/v1",
			}),
		);
		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			expect(getUrl(input)).toBe("https://api.xenonintellect.ai/api/v1/user/whoami");
			expect(getAuthorization(init)).toBe("Bearer xenon-cli-key");
			return jsonResponse({ data: { scope: { agent_traces: { write: true } } } });
		});
		const onAuth = vi.fn();

		const result = await loginXenonAgentTraces(
			{ onAuth },
			{ configPath, fetchFn: fetchMock, requestTimeoutMs: 1000 },
		);

		expect(result).toEqual({ apiKey: "xenon-cli-key", source: "xenon-cli" });
		expect(onAuth).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("validates imported Xenon CLI trace credentials against XENON_AGENT_TRACES_BASE_URL", async () => {
		process.env.XENON_AGENT_TRACES_BASE_URL = "https://trace-api.example/api/v1";
		writeFileSync(
			configPath,
			JSON.stringify({
				api_key: "xenon-cli-key",
				base_url: "https://dev-api.example/api/v1",
			}),
		);
		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			expect(getUrl(input)).toBe("https://trace-api.example/api/v1/user/whoami");
			expect(getAuthorization(init)).toBe("Bearer xenon-cli-key");
			return jsonResponse({ data: { scope: { agent_traces: { write: true } } } });
		});
		const onAuth = vi.fn();

		const result = await loginXenonAgentTraces(
			{ onAuth },
			{ configPath, fetchFn: fetchMock, requestTimeoutMs: 1000 },
		);

		expect(result).toEqual({ apiKey: "xenon-cli-key", source: "xenon-cli" });
		expect(onAuth).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("throws contextual errors for invalid Xenon whoami JSON", async () => {
		const fetchMock = vi.fn(async (): Promise<Response> => {
			return new Response("not json", {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});

		await expect(
			checkXenonInferenceAccess("xenon-key", "https://xenon-api.example", { fetchFn: fetchMock }),
		).rejects.toThrow("Xenon whoami returned an invalid response");
	});

	it("imports a valid Xenon CLI key", async () => {
		writeFileSync(configPath, JSON.stringify({ api_key: "xenon-cli-key" }));
		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			expect(getUrl(input)).toBe("https://api.xenonintellect.ai/api/v1/user/whoami");
			expect(getAuthorization(init)).toBe("Bearer xenon-cli-key");
			return jsonResponse({ data: { scope: { inference: { write: true } } } });
		});
		const onAuth = vi.fn();

		const result = await loginXenonInference({ onAuth }, { configPath, fetchFn: fetchMock, requestTimeoutMs: 1000 });

		expect(result).toEqual({ apiKey: "xenon-cli-key", source: "xenon-cli" });
		expect(onAuth).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("honors cancellation before returning an imported Xenon CLI key", async () => {
		writeFileSync(configPath, JSON.stringify({ api_key: "xenon-cli-key" }));
		const controller = new AbortController();
		const fetchMock = vi.fn(async (): Promise<Response> => {
			const response = jsonResponse({ data: { scope: { inference: { write: true } } } });
			vi.spyOn(response, "json").mockImplementation(async () => {
				controller.abort();
				return { data: { scope: { inference: { write: true } } } };
			});
			return response;
		});

		await expect(
			loginXenonInference(
				{
					onAuth: () => {},
					signal: controller.signal,
				},
				{ configPath, fetchFn: fetchMock, requestTimeoutMs: 1000 },
			),
		).rejects.toThrow("Login cancelled");
	});

	it("falls back to browser login when the Xenon CLI key cannot access inference", async () => {
		writeFileSync(
			configPath,
			JSON.stringify({
				api_key: "old-key",
				base_url: "https://xenon-api.example",
				frontend_url: "https://xenon-app.example",
				inference_url: "https://pinference.example/api/v1",
			}),
		);
		let challengePublicKey = "";
		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const url = getUrl(input);
			if (url === "https://xenon-api.example/api/v1/user/whoami") {
				const auth = getAuthorization(init);
				if (auth === "Bearer old-key") {
					return jsonResponse({ data: { scope: { inference: { read: true, write: false } } } });
				}
				if (auth === "Bearer browser-key") {
					return jsonResponse({ data: { scope: { inference: { read: true, write: true } } } });
				}
			}
			if (url === "https://xenon-api.example/api/v1/auth_challenge/generate") {
				challengePublicKey = String(getJsonBody(init).encryptionPublicKey);
				return jsonResponse({ challenge: "challenge-code", status_auth_token: "status-token" });
			}
			if (url.startsWith("https://xenon-api.example/api/v1/auth_challenge/status")) {
				expect(getAuthorization(init)).toBe("Bearer status-token");
				return jsonResponse({ result: encryptChallengeResult(challengePublicKey, "browser-key") });
			}
			throw new Error(`Unexpected fetch URL: ${url}`);
		});
		const onAuth = vi.fn();
		const progress: string[] = [];

		const result = await loginXenonInference(
			{
				onAuth,
				onProgress: (message) => progress.push(message),
			},
			{ configPath, fetchFn: fetchMock, pollIntervalMs: 0, requestTimeoutMs: 1000 },
		);

		expect(result).toEqual({ apiKey: "browser-key", source: "browser" });
		expect(onAuth).toHaveBeenCalledWith({
			url: "https://xenon-app.example/dashboard/tokens/challenge?code=challenge-code",
			instructions: "Code: challenge-code",
		});
		expect(progress.join("\n")).toContain("Existing Xenon CLI key cannot access Xenon Inference");
	});

	it("requests agent trace scope during Xenon Agent trace browser login", async () => {
		process.env.XENON_AGENT_TRACES_BASE_URL = "https://xenon-api.example/api/v1";
		writeFileSync(
			configPath,
			JSON.stringify({
				base_url: "https://xenon-api.example",
				frontend_url: "https://xenon-app.example",
			}),
		);
		let challengePublicKey = "";
		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const url = getUrl(input);
			if (url === "https://xenon-api.example/api/v1/auth_challenge/generate") {
				challengePublicKey = String(getJsonBody(init).encryptionPublicKey);
				return jsonResponse({ challenge: "challenge-code", status_auth_token: "status-token" });
			}
			if (url.startsWith("https://xenon-api.example/api/v1/auth_challenge/status")) {
				expect(getAuthorization(init)).toBe("Bearer status-token");
				return jsonResponse({ result: encryptChallengeResult(challengePublicKey, "trace-key") });
			}
			if (url === "https://xenon-api.example/api/v1/user/whoami") {
				expect(getAuthorization(init)).toBe("Bearer trace-key");
				return jsonResponse({ data: { scope: { agent_traces: { read: true, write: true } } } });
			}
			throw new Error(`Unexpected fetch URL: ${url}`);
		});
		const onAuth = vi.fn();

		const result = await loginXenonAgentTraces(
			{
				onAuth,
			},
			{ configPath, fetchFn: fetchMock, pollIntervalMs: 0, requestTimeoutMs: 1000 },
		);

		expect(result).toEqual({ apiKey: "trace-key", source: "browser" });
		expect(onAuth).toHaveBeenCalledWith({
			url: "https://xenon-app.example/dashboard/tokens/challenge?code=challenge-code&scope=agent_traces",
			instructions: "Code: challenge-code",
		});
	});

	it("rejects an expired browser challenge", async () => {
		writeFileSync(configPath, JSON.stringify({ base_url: "https://xenon-api.example" }));
		const fetchMock = vi.fn(async (input: string | URL | Request): Promise<Response> => {
			const url = getUrl(input);
			if (url === "https://xenon-api.example/api/v1/auth_challenge/generate") {
				return jsonResponse({ challenge: "challenge-code", status_auth_token: "status-token" });
			}
			if (url.startsWith("https://xenon-api.example/api/v1/auth_challenge/status")) {
				return new Response("expired", { status: 404 });
			}
			throw new Error(`Unexpected fetch URL: ${url}`);
		});

		await expect(
			loginXenonInference({ onAuth: () => {} }, { configPath, fetchFn: fetchMock, pollIntervalMs: 0 }),
		).rejects.toThrow("Xenon login challenge expired");
	});
});
