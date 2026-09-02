import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import type { AuthStatus } from "../src/core/auth-storage.js";
import { XENON_INFERENCE_PROVIDER_ID } from "../src/core/xenon-inference-auth.js";
import {
	type OnboardingStartupState,
	shouldRunOnboarding,
	shouldRunXenonCliOnboardingSplash,
} from "../src/modes/interactive/onboarding.js";

function makeModel(provider: string): Model<Api> {
	return { id: "test-model", provider } as Model<Api>;
}

function makeState(overrides: {
	onboardingShown: boolean;
	model: Model<Api> | undefined;
	modelHasAuth?: boolean;
	xenonAuthSource?: AuthStatus["source"];
}): OnboardingStartupState {
	return {
		settingsManager: {
			getOnboardingShown: () => overrides.onboardingShown,
		},
		modelRegistry: {
			refresh: () => {},
			hasConfiguredAuth: () => overrides.modelHasAuth ?? false,
			getProviderAuthStatus: () => ({
				configured: overrides.xenonAuthSource !== undefined,
				source: overrides.xenonAuthSource,
			}),
		},
		model: overrides.model,
	};
}

describe("startup onboarding decision", () => {
	test("runs onboarding on first launch with Xenon CLI auth", () => {
		const state = makeState({
			onboardingShown: false,
			model: makeModel(XENON_INFERENCE_PROVIDER_ID),
			modelHasAuth: true,
			xenonAuthSource: "xenon_cli",
		});
		expect(shouldRunXenonCliOnboardingSplash(state)).toBe(true);
		expect(shouldRunOnboarding(state)).toBe(true);
	});

	test("runs onboarding on first launch when no model is available", () => {
		expect(shouldRunOnboarding(makeState({ onboardingShown: false, model: undefined }))).toBe(true);
	});

	test("does not reopen onboarding after dismissal when the current model has no local auth", () => {
		expect(
			shouldRunOnboarding(makeState({ onboardingShown: true, model: makeModel("anthropic"), modelHasAuth: false })),
		).toBe(false);
	});

	test("does not reopen onboarding after dismissal when no model is available", () => {
		expect(shouldRunOnboarding(makeState({ onboardingShown: true, model: undefined }))).toBe(false);
	});

	test("skips onboarding once completed with a ready model", () => {
		const state = makeState({
			onboardingShown: true,
			model: makeModel(XENON_INFERENCE_PROVIDER_ID),
			modelHasAuth: true,
			xenonAuthSource: "xenon_cli",
		});
		expect(shouldRunXenonCliOnboardingSplash(state)).toBe(false);
		expect(shouldRunOnboarding(state)).toBe(false);
	});

	test("skips the Xenon CLI splash for non-Xenon providers with ready auth", () => {
		const state = makeState({
			onboardingShown: false,
			model: makeModel("anthropic"),
			modelHasAuth: true,
			xenonAuthSource: "stored",
		});
		expect(shouldRunXenonCliOnboardingSplash(state)).toBe(false);
		expect(shouldRunOnboarding(state)).toBe(false);
	});
});
