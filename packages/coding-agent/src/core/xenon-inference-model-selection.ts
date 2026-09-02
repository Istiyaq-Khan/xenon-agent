import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "./model-registry.js";
import { XENON_INFERENCE_DEFAULT_MODEL_ID } from "./model-resolver.js";
import { XENON_INFERENCE_PROVIDER_ID } from "./xenon-inference-auth.js";

type ProviderLoginResult =
	| { status: "success"; providerId: string; kind?: "provider" | "service" }
	| { status: "cancelled" | "failed" };

export interface XenonInferencePostLoginModelAction {
	openModelPicker: boolean;
	fallbackModel?: Model<Api>;
}

export function resolveXenonInferencePostLoginModelAction(
	authResult: ProviderLoginResult,
	currentModel: Model<Api> | undefined,
	modelRegistry: Pick<ModelRegistry, "find">,
): XenonInferencePostLoginModelAction {
	if (
		authResult.status !== "success" ||
		authResult.kind === "service" ||
		authResult.providerId !== XENON_INFERENCE_PROVIDER_ID
	) {
		return { openModelPicker: false };
	}

	return {
		openModelPicker: true,
		fallbackModel: currentModel
			? undefined
			: modelRegistry.find(XENON_INFERENCE_PROVIDER_ID, XENON_INFERENCE_DEFAULT_MODEL_ID),
	};
}
