import { afterEach, describe, expect, it } from "vitest";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.js";
import { getModel, getModels } from "../src/models.js";

const originalNvidiaApiKey = process.env.NVIDIA_API_KEY;

afterEach(() => {
	if (originalNvidiaApiKey === undefined) {
		delete process.env.NVIDIA_API_KEY;
	} else {
		process.env.NVIDIA_API_KEY = originalNvidiaApiKey;
	}
});

describe("NVIDIA NIM models", () => {
	it("registers the NVIDIA NIM catalog", () => {
		const models = getModels("nvidia");
		const modelIds = models.map((model) => model.id);

		expect(modelIds.length).toBeGreaterThanOrEqual(9);
		expect(modelIds).toEqual(
			expect.arrayContaining([
				"moonshotai/kimi-k3",
				"meta/llama-3.3-70b-instruct",
				"deepseek-ai/deepseek-r1",
				"nvidia/llama-3.1-nemotron-70b-instruct",
				"meta/llama-3.1-405b-instruct",
				"meta/llama-3.1-8b-instruct",
				"mistralai/mistral-large-2-instruct",
				"nvidia/nemotron-4-340b-instruct",
				"qwen/qwen2.5-72b-instruct",
			]),
		);

		for (const model of models) {
			expect(model.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
			expect(model.api).toBe("openai-completions");
		}
	});

	it("registers alias models under nvidia-nim", () => {
		const aliasModels = getModels("nvidia-nim");
		expect(aliasModels.length).toBeGreaterThanOrEqual(9);
		expect(aliasModels[0].provider).toBe("nvidia-nim");
	});

	it("resolves NVIDIA_API_KEY from environment", () => {
		process.env.NVIDIA_API_KEY = "test-nvidia-key";

		expect(findEnvKeys("nvidia")).toEqual(["NVIDIA_API_KEY"]);
		expect(getEnvApiKey("nvidia")).toBe("test-nvidia-key");

		expect(findEnvKeys("nvidia-nim")).toEqual(["NVIDIA_API_KEY"]);
		expect(getEnvApiKey("nvidia-nim")).toBe("test-nvidia-key");
	});

	it("returns undefined when no key is set", () => {
		delete process.env.NVIDIA_API_KEY;

		expect(findEnvKeys("nvidia")).toBeUndefined();
		expect(getEnvApiKey("nvidia")).toBeUndefined();
	});

	it("retrieves a model with correct properties", () => {
		const model = getModel("nvidia", "meta/llama-3.3-70b-instruct");
		expect(model).toBeDefined();
		expect(model.api).toBe("openai-completions");
		expect(model.provider).toBe("nvidia");
		expect(model.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
		expect(model.featured).toBe(true);
	});
});
