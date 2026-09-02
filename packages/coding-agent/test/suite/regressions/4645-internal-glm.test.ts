import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AuthStorage } from "../../../src/core/auth-storage.js";
import { ModelRegistry } from "../../../src/core/model-registry.js";
import { findInitialModel, restoreModelFromSession } from "../../../src/core/model-resolver.js";
import { createHarness, type Harness } from "../harness.js";

describe("ENG-4645 internal GLM configuration", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		vi.unstubAllGlobals();
		for (const harness of harnesses.splice(0)) {
			harness.cleanup();
		}
	});

	test("shows the private route when the selected team's catalog authorizes it", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		const fetchMock = vi.fn(async () => {
			return new Response(JSON.stringify({ data: [{ id: "internal/glm-5.2-fast" }] }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);
		const authStorage = AuthStorage.inMemory({
			"xenon-inference": {
				type: "api_key",
				key: "xenon-key",
				xenonTeam: { teamId: "engineering-team", name: "Xenon Engineering" },
			},
		});
		const registry = ModelRegistry.inMemory(authStorage);

		expect(registry.getAvailable().some((model) => model.id === "internal/glm-5.2-fast")).toBe(false);
		const models = await registry.refreshAvailableModels();
		const model = models.find((candidate) => candidate.id === "internal/glm-5.2-fast");

		expect(model).toMatchObject({
			name: "GLM 5.2 Fast",
			api: "openai-completions",
			provider: "xenon-inference",
			baseUrl: "https://api.pinference.ai/api/v1",
			reasoning: true,
			contextWindow: 400000,
			maxTokens: 131072,
			featured: true,
			compat: {
				supportsDeveloperRole: false,
				maxTokensField: "max_tokens",
			},
		});
		expect(fetchMock).toHaveBeenCalledWith("https://api.pinference.ai/api/v1/models", {
			headers: {
				Authorization: "Bearer xenon-key",
				"X-Xenon-Team-ID": "engineering-team",
			},
			signal: expect.any(AbortSignal),
		});
	});

	test("hides the private route when the selected team's catalog omits it", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
		);
		const authStorage = AuthStorage.inMemory({
			"xenon-inference": {
				type: "api_key",
				key: "xenon-key",
				xenonTeam: { teamId: "other-team", name: "Other Team" },
			},
		});
		const registry = ModelRegistry.inMemory(authStorage);

		expect((await registry.refreshAvailableModels()).some((model) => model.id === "internal/glm-5.2-fast")).toBe(
			false,
		);
	});

	test("preserves authorization on transient failures only for the same team", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ data: [{ id: "internal/glm-5.2-fast" }] }), { status: 200 }),
			)
			.mockResolvedValue(new Response(null, { status: 503 }));
		vi.stubGlobal("fetch", fetchMock);
		const authStorage = AuthStorage.inMemory({
			"xenon-inference": {
				type: "api_key",
				key: "xenon-key",
				xenonTeam: { teamId: "engineering-team", name: "Xenon Engineering" },
			},
		});
		const registry = ModelRegistry.inMemory(authStorage);

		expect((await registry.refreshAvailableModels()).some((model) => model.id === "internal/glm-5.2-fast")).toBe(
			true,
		);
		expect((await registry.refreshAvailableModels()).some((model) => model.id === "internal/glm-5.2-fast")).toBe(
			true,
		);

		authStorage.set("xenon-inference", {
			type: "api_key",
			key: "xenon-key",
			xenonTeam: { teamId: "other-team", name: "Other Team" },
		});
		expect((await registry.refreshAvailableModels()).some((model) => model.id === "internal/glm-5.2-fast")).toBe(
			false,
		);
	});

	test("does not restore a private route that the selected team cannot access", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
		);
		const authStorage = AuthStorage.inMemory({
			"xenon-inference": {
				type: "api_key",
				key: "xenon-key",
				xenonTeam: { teamId: "other-team", name: "Other Team" },
			},
		});
		const registry = ModelRegistry.inMemory(authStorage);

		const initial = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			defaultProvider: "xenon-inference",
			defaultModelId: "internal/glm-5.2-fast",
			modelRegistry: registry,
		});
		expect(initial.model?.id).not.toBe("internal/glm-5.2-fast");

		const restored = await restoreModelFromSession(
			"xenon-inference",
			"internal/glm-5.2-fast",
			undefined,
			false,
			registry,
		);
		expect(restored.model?.id).not.toBe("internal/glm-5.2-fast");
		expect(restored.fallbackMessage).toContain("model is not available");
	});

	test("selects an authorized private route from a saved default on cold start", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ data: [{ id: "internal/glm-5.2-fast" }] }), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const authStorage = AuthStorage.inMemory({
			"xenon-inference": {
				type: "api_key",
				key: "xenon-key",
				xenonTeam: { teamId: "engineering-team", name: "Xenon Engineering" },
			},
		});
		const registry = ModelRegistry.inMemory(authStorage);

		const initial = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			defaultProvider: "xenon-inference",
			defaultModelId: "internal/glm-5.2-fast",
			modelRegistry: registry,
		});

		expect(initial.model?.id).toBe("internal/glm-5.2-fast");
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	test("refreshes private routes before cycling models", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const currentModel = harness.session.model;
		const privateModel = harness.session.modelRegistry.find("xenon-inference", "internal/glm-5.2-fast");
		expect(currentModel).toBeDefined();
		expect(privateModel).toBeDefined();
		if (!currentModel || !privateModel) {
			throw new Error("Expected current and private models");
		}
		const refreshSpy = vi
			.spyOn(harness.session.modelRegistry, "refreshAvailableModels")
			.mockResolvedValue([currentModel, privateModel]);

		const result = await harness.session.cycleModel();

		expect(refreshSpy).toHaveBeenCalledOnce();
		expect(result?.model.id).toBe("internal/glm-5.2-fast");
	});

	test("rejects unauthorized direct and scoped model switches", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.authStorage.set("xenon-inference", {
			type: "api_key",
			key: "xenon-key",
			xenonTeam: { teamId: "other-team", name: "Other Team" },
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
		);
		const currentModel = harness.session.model;
		const privateModel = harness.session.modelRegistry.find("xenon-inference", "internal/glm-5.2-fast");
		expect(currentModel).toBeDefined();
		expect(privateModel).toBeDefined();
		if (!currentModel || !privateModel) {
			throw new Error("Expected current and private models");
		}

		await expect(harness.session.setModel(privateModel)).rejects.toThrow("not available for the current Xenon team");
		harness.session.setScopedModels([{ model: currentModel }, { model: privateModel }]);

		expect(await harness.session.cycleModel()).toBeUndefined();
		expect(harness.session.model).toBe(currentModel);
	});

	test("loads the private route explicitly without inheriting Z.ai compatibility", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		const modelsJsonPath = join(harness.tempDir, "models.json");
		writeFileSync(
			modelsJsonPath,
			JSON.stringify({
				providers: {
					"xenon-inference": {
						baseUrl: "https://api.pinference.ai/api/v1",
						api: "openai-completions",
						compat: {
							supportsDeveloperRole: false,
							maxTokensField: "max_tokens",
						},
						models: [
							{
								id: "internal/glm-5.2-fast",
								name: "GLM 5.2 Fast",
								reasoning: true,
								contextWindow: 400000,
								maxTokens: 131072,
							},
						],
					},
				},
			}),
		);
		const authStorage = AuthStorage.inMemory({
			"xenon-inference": {
				type: "api_key",
				key: "xenon-key",
				xenonTeam: { teamId: "engineering-team", name: "Xenon Engineering" },
			},
		});
		const registry = ModelRegistry.create(authStorage, modelsJsonPath);

		expect(registry.getError()).toBeUndefined();
		expect(registry.getAvailable().some((model) => model.id === "internal/glm-5.2-fast")).toBe(true);
		const model = registry.find("xenon-inference", "internal/glm-5.2-fast");
		expect(model).toMatchObject({
			id: "internal/glm-5.2-fast",
			name: "GLM 5.2 Fast",
			api: "openai-completions",
			provider: "xenon-inference",
			baseUrl: "https://api.pinference.ai/api/v1",
			reasoning: true,
			contextWindow: 400000,
			maxTokens: 131072,
			compat: {
				supportsDeveloperRole: false,
				maxTokensField: "max_tokens",
			},
		});
		expect(model?.compat).not.toMatchObject({ thinkingFormat: "zai" });
		expect(model?.compat).not.toMatchObject({ supportsReasoningEffort: false });

		expect(await registry.getApiKeyAndHeaders(model!)).toEqual({
			ok: true,
			apiKey: "xenon-key",
			headers: { "X-Xenon-Team-ID": "engineering-team" },
		});
	});
});
