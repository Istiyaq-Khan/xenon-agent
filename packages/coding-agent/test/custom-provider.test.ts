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
		expect(defaultModelPerProvider.nvidia).toBe("meta/llama-3.3-70b-instruct");
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
});
