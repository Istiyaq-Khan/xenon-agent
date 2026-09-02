import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import type { AuthStatus } from "../src/core/auth-storage.js";
import {
	isOnboardingModelReady,
	type OnboardingStartupState,
	shouldRunOnboarding,
} from "../src/modes/interactive/onboarding.js";

function makeModel(provider: string): Model<Api> {
	return { id: "test-model", provider } as Model<Api>;
}

function makeState(overrides: {
	onboardingShown: boolean;
	model: Model<Api> | undefined;
	modelHasAuth?: boolean;
	authSource?: AuthStatus["source"];
}): OnboardingStartupState {
	return {
		settingsManager: {
			getOnboardingShown: () => overrides.onboardingShown,
		},
		modelRegistry: {
			refresh: () => {},
			hasConfiguredAuth: () => overrides.modelHasAuth ?? false,
			getProviderAuthStatus: () => ({
				configured: overrides.authSource !== undefined,
				source: overrides.authSource,
			}),
		},
		model: overrides.model,
	};
}

describe("startup onboarding decision", () => {
	test("runs onboarding on first launch when no model is ready", () => {
		const state = makeState({
			onboardingShown: false,
			model: undefined,
			modelHasAuth: false,
		});
		expect(shouldRunOnboarding(state)).toBe(true);
		expect(isOnboardingModelReady(state)).toBe(false);
	});

	test("skips onboarding on first launch when a model is already configured and ready", () => {
		const state = makeState({
			onboardingShown: false,
			model: makeModel("nvidia"),
			modelHasAuth: true,
			authSource: "environment",
		});
		expect(shouldRunOnboarding(state)).toBe(false);
		expect(isOnboardingModelReady(state)).toBe(true);
	});

	test("does not reopen onboarding after dismissal when current model has no local auth", () => {
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
			model: makeModel("openai"),
			modelHasAuth: true,
			authSource: "environment",
		});
		expect(shouldRunOnboarding(state)).toBe(false);
	});
});
