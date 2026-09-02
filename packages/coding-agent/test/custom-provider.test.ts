import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { defaultModelPerProvider } from "../src/core/model-resolver.js";
import { BUILT_IN_PROVIDER_DISPLAY_NAMES } from "../src/core/provider-display-names.js";

describe("Custom Provider and NVIDIA NIM integration", () => {
	let tempDir: string;
	let authJsonPath: string;
	let modelsJsonPath: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `custom-prov-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		authJsonPath = join(tempDir, "auth.json");
		modelsJsonPath = join(tempDir, "models.json");
		writeFileSync(authJsonPath, "{}");
		writeFileSync(modelsJsonPath, "{}");
	});

	afterEach(() => {
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	it("registers NVIDIA NIM in display names and default model resolver", () => {
		expect(BUILT_IN_PROVIDER_DISPLAY_NAMES.nvidia).toBe("NVIDIA NIM");
		expect(BUILT_IN_PROVIDER_DISPLAY_NAMES["nvidia-nim"]).toBe("NVIDIA NIM");
		expect(defaultModelPerProvider["nvidia-nim"]).toBe("meta/llama-3.3-70b-instruct");
	});

	it("resolves dynamic models for custom providers with OpenAI protocol", () => {
		const authStorage = AuthStorage.create(authJsonPath);
		authStorage.set("local-vllm", { type: "api_key", key: "test-vllm-key" });

		writeFileSync(
			modelsJsonPath,
			JSON.stringify({
				providers: {
					"local-vllm": {
						baseUrl: "http://localhost:8000/v1",
						apiKey: "test-vllm-key",
						api: "openai-completions",
					},
				},
			}),
		);

		const registry = ModelRegistry.create(authStorage, modelsJsonPath);
		const dynamicModel = registry.find("local-vllm", "custom-model-70b");

		expect(dynamicModel).toBeDefined();
		expect(dynamicModel?.provider).toBe("local-vllm");
		expect(dynamicModel?.id).toBe("custom-model-70b");
		expect(dynamicModel?.api).toBe("openai-completions");
		expect(dynamicModel?.baseUrl).toBe("http://localhost:8000/v1");
		expect(registry.hasConfiguredAuth(dynamicModel!)).toBe(true);
	});

	it("supports custom providers declared in settings format", () => {
		const authStorage = AuthStorage.create(authJsonPath);
		authStorage.set("my-anthropic-proxy", { type: "api_key", key: "sk-ant-test" });

		writeFileSync(
			modelsJsonPath,
			JSON.stringify({
				providers: {
					"my-anthropic-proxy": {
						baseUrl: "https://anthropic.corp.internal/v1",
						apiKey: "sk-ant-test",
						api: "anthropic-messages",
						models: [
							{
								id: "claude-3-5-sonnet",
								name: "Claude 3.5 Sonnet (Corp)",
								contextWindow: 200000,
								maxTokens: 8192,
							},
						],
					},
				},
			}),
		);

		const registry = ModelRegistry.create(authStorage, modelsJsonPath);
		const model = registry.find("my-anthropic-proxy", "claude-3-5-sonnet");

		expect(model).toBeDefined();
		expect(model?.api).toBe("anthropic-messages");
		expect(model?.baseUrl).toBe("https://anthropic.corp.internal/v1");
		expect(model?.contextWindow).toBe(200000);
	});

	it("canonicalizes nvidia-nim in authStorage, trims keys, and supports backwards-compatible aliasing", async () => {
		const authStorage = AuthStorage.create(authJsonPath);

		// Test trimming and canonicalization
		authStorage.set("NVIDIA NIM", { type: "api_key", key: "  nvapi-test-key-123\n\n" });
		expect(authStorage.get("nvidia-nim")).toEqual({ type: "api_key", key: "nvapi-test-key-123" });
		expect(authStorage.get("nvidia")).toEqual({ type: "api_key", key: "nvapi-test-key-123" });
		expect(await authStorage.getApiKey("nvidia-nim")).toBe("nvapi-test-key-123");

		// Test reading legacy auth.json written as "nvidia"
		writeFileSync(
			authJsonPath,
			JSON.stringify({
				nvidia: { type: "api_key", key: "legacy-nv-key" },
			}),
		);
		const reloadedAuth = AuthStorage.create(authJsonPath);
		expect(reloadedAuth.get("nvidia-nim")).toEqual({ type: "api_key", key: "legacy-nv-key" });
		expect(await reloadedAuth.getApiKey("nvidia-nim")).toBe("legacy-nv-key");
	});

	it("resolves NVIDIA NIM API keys from NVIDIA_API_KEY and NVIDIA_NIM_API_KEY", async () => {
		const authStorage = AuthStorage.create(authJsonPath);
		const savedKey1 = process.env.NVIDIA_API_KEY;
		const savedKey2 = process.env.NVIDIA_NIM_API_KEY;
		delete process.env.NVIDIA_API_KEY;
		delete process.env.NVIDIA_NIM_API_KEY;

		try {
			process.env.NVIDIA_NIM_API_KEY = "nim-env-key";
			expect(await authStorage.getApiKey("nvidia-nim")).toBe("nim-env-key");

			process.env.NVIDIA_API_KEY = "nvidia-primary-env-key";
			expect(await authStorage.getApiKey("nvidia-nim")).toBe("nvidia-primary-env-key");
		} finally {
			if (savedKey1 !== undefined) process.env.NVIDIA_API_KEY = savedKey1;
			else delete process.env.NVIDIA_API_KEY;
			if (savedKey2 !== undefined) process.env.NVIDIA_NIM_API_KEY = savedKey2;
			else delete process.env.NVIDIA_NIM_API_KEY;
		}
	});
});
