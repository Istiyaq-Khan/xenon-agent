import type { Model } from "@earendil-works/pi-ai";

export const XENON_INFERENCE_BASE_URL = "https://api.pinference.ai/api/v1";
const PRIVATE_MODEL_REFRESH_TIMEOUT_MS = 10_000;

const PRIVATE_XENON_INFERENCE_MODELS: readonly Model<"openai-completions">[] = [
	{
		id: "internal/glm-5.2-fast",
		name: "GLM 5.2 Fast",
		api: "openai-completions",
		provider: "xenon-inference",
		baseUrl: XENON_INFERENCE_BASE_URL,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 400000,
		maxTokens: 131072,
		featured: true,
		compat: {
			supportsDeveloperRole: false,
			maxTokensField: "max_tokens",
		},
	},
];

export function isPrivateXenonInferenceModel(model: Pick<Model<string>, "provider" | "id">): boolean {
	return model.provider === "xenon-inference" && model.id.startsWith("internal/");
}

export function getPrivateXenonInferenceModels(): Model<"openai-completions">[] {
	return PRIVATE_XENON_INFERENCE_MODELS.map((model) => ({
		...model,
		input: [...model.input],
		cost: { ...model.cost },
		compat: model.compat ? { ...model.compat } : undefined,
	}));
}

export async function fetchAuthorizedPrivateXenonInferenceModelIds(
	apiKey: string,
	teamHeaders: Record<string, string>,
	fetchFn: typeof fetch = fetch,
	timeoutMs: number = PRIVATE_MODEL_REFRESH_TIMEOUT_MS,
): Promise<Set<string>> {
	if (!teamHeaders["X-Xenon-Team-ID"]) {
		return new Set();
	}

	const response = await fetchFn(`${XENON_INFERENCE_BASE_URL}/models`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			...teamHeaders,
		},
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (response.status === 401 || response.status === 403) {
		return new Set();
	}
	if (!response.ok) {
		throw new Error(`Xenon Inference model catalog request failed with status ${response.status}`);
	}

	const payload = (await response.json()) as unknown;
	if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) {
		throw new Error("Xenon Inference model catalog response is invalid");
	}

	const knownPrivateIds = new Set(PRIVATE_XENON_INFERENCE_MODELS.map((model) => model.id));
	return new Set(
		payload.data.flatMap((entry) => {
			if (!entry || typeof entry !== "object" || !("id" in entry) || typeof entry.id !== "string") {
				return [];
			}
			return knownPrivateIds.has(entry.id) ? [entry.id] : [];
		}),
	);
}
