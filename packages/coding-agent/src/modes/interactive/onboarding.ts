import type { Api, Model } from "@earendil-works/pi-ai";
import type { AuthStatus } from "../../core/auth-storage.js";
import { XENON_INFERENCE_PROVIDER_ID } from "../../core/xenon-inference-auth.js";

export interface OnboardingSettingsReader {
	getOnboardingShown(): boolean;
}

export interface OnboardingModelRegistryReader {
	refresh(): void;
	hasConfiguredAuth(model: Model<Api>): boolean;
	getProviderAuthStatus(provider: string): AuthStatus;
}

export interface OnboardingStartupState {
	settingsManager: OnboardingSettingsReader;
	modelRegistry: OnboardingModelRegistryReader;
	model: Model<Api> | undefined;
}

export function shouldRunXenonCliOnboardingSplash(state: OnboardingStartupState): boolean {
	if (state.settingsManager.getOnboardingShown()) {
		return false;
	}
	if (!state.model || state.model.provider !== XENON_INFERENCE_PROVIDER_ID) {
		return false;
	}
	const authStatus = state.modelRegistry.getProviderAuthStatus(XENON_INFERENCE_PROVIDER_ID);
	return authStatus.source === "xenon_cli";
}

export function isOnboardingModelReady(state: OnboardingStartupState): boolean {
	return state.model !== undefined && state.modelRegistry.hasConfiguredAuth(state.model);
}

export function shouldRunOnboarding(state: OnboardingStartupState): boolean {
	if (state.settingsManager.getOnboardingShown()) {
		return false;
	}
	state.modelRegistry.refresh();
	if (shouldRunXenonCliOnboardingSplash(state)) {
		return true;
	}
	return !isOnboardingModelReady(state);
}
