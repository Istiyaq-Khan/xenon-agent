/**
 * Credential storage for API keys and OAuth tokens.
 * Handles loading, saving, and refreshing credentials from auth.json.
 *
 * Uses file locking to prevent race conditions when multiple pi instances
 * try to refresh tokens simultaneously.
 */

import { createHash } from "node:crypto";
import {
	findEnvKeys,
	getEnvApiKey,
	normalizeProviderId,
	type OAuthCredentials,
	type OAuthLoginCallbacks,
	type OAuthProviderId,
} from "@earendil-works/pi-ai";
import { getOAuthProvider, getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "../config.js";
import { resolveConfigValue, resolveConfigValueUncached } from "./resolve-config-value.js";

export type ApiKeyCredential = {
	type: "api_key";
	key: string;
};

export type OAuthCredential = {
	type: "oauth";
} & OAuthCredentials;

export type AuthCredential = ApiKeyCredential | OAuthCredential;

export type AuthStorageData = Record<string, AuthCredential>;

export type AuthStatus = {
	configured: boolean;
	source?: "stored" | "runtime" | "environment" | "fallback" | "models_json_key" | "models_json_command" | "stale";
	label?: string;
};

export type AuthStorageOptions = {
	xenonCliConfigPath?: string;
	useXenonCliConfig?: boolean;
};

type LockResult<T> = {
	result: T;
	next?: string;
};

type ActiveAuthStatusSource = Exclude<NonNullable<AuthStatus["source"]>, "stale">;

export type AuthSourceToken = {
	provider: string;
	source: ActiveAuthStatusSource;
	identityFingerprint: string;
	valueFingerprint: string;
};

type AuthSourceCandidate = {
	source: ActiveAuthStatusSource;
	configured: boolean;
	label?: string;
	identityFingerprint: string;
	valueFingerprint?: string;
	resolveValueFingerprint?: () => string | undefined;
};

type AuthApiKeyResult = {
	apiKey?: string;
	sourceToken?: AuthSourceToken;
};

export interface AuthStorageBackend {
	withLock<T>(fn: (current: string | undefined) => LockResult<T>): T;
	withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T>;
}

export class FileAuthStorageBackend implements AuthStorageBackend {
	constructor(private authPath: string = join(getAgentDir(), "auth.json")) {}

	private ensureParentDir(): void {
		const dir = dirname(this.authPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
	}

	private ensureFileExists(): void {
		if (!existsSync(this.authPath)) {
			writeFileSync(this.authPath, "{}", "utf-8");
			chmodSync(this.authPath, 0o600);
		}
	}

	private acquireLockSyncWithRetry(path: string): () => void {
		const maxAttempts = 10;
		const delayMs = 20;
		let lastError: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return lockfile.lockSync(path, { realpath: false });
			} catch (error) {
				const code =
					typeof error === "object" && error !== null && "code" in error
						? String((error as { code?: unknown }).code)
						: undefined;
				if (code !== "ELOCKED" || attempt === maxAttempts) {
					throw error;
				}
				lastError = error;
				const start = Date.now();
				while (Date.now() - start < delayMs) {
					// Sleep synchronously to avoid changing callers to async.
				}
			}
		}

		throw (lastError as Error) ?? new Error("Failed to acquire auth storage lock");
	}

	withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
		this.ensureParentDir();
		this.ensureFileExists();

		let release: (() => void) | undefined;
		try {
			release = this.acquireLockSyncWithRetry(this.authPath);
			const current = existsSync(this.authPath) ? readFileSync(this.authPath, "utf-8") : undefined;
			const { result, next } = fn(current);
			if (next !== undefined) {
				writeFileSync(this.authPath, next, "utf-8");
				chmodSync(this.authPath, 0o600);
			}
			return result;
		} finally {
			if (release) {
				release();
			}
		}
	}

	async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T> {
		this.ensureParentDir();
		this.ensureFileExists();

		let release: (() => Promise<void>) | undefined;
		let lockCompromised = false;
		let lockCompromisedError: Error | undefined;
		const throwIfCompromised = () => {
			if (lockCompromised) {
				throw lockCompromisedError ?? new Error("Auth storage lock was compromised");
			}
		};

		try {
			release = await lockfile.lock(this.authPath, {
				retries: {
					retries: 10,
					factor: 2,
					minTimeout: 100,
					maxTimeout: 10000,
					randomize: true,
				},
				stale: 30000,
				onCompromised: (err) => {
					lockCompromised = true;
					lockCompromisedError = err;
				},
			});

			throwIfCompromised();
			const current = existsSync(this.authPath) ? readFileSync(this.authPath, "utf-8") : undefined;
			const { result, next } = await fn(current);
			throwIfCompromised();
			if (next !== undefined) {
				writeFileSync(this.authPath, next, "utf-8");
				chmodSync(this.authPath, 0o600);
			}
			throwIfCompromised();
			return result;
		} finally {
			if (release) {
				try {
					await release();
				} catch {
					// Ignore unlock errors when lock is compromised.
				}
			}
		}
	}
}

export class InMemoryAuthStorageBackend implements AuthStorageBackend {
	private value: string | undefined;

	withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
		const { result, next } = fn(this.value);
		if (next !== undefined) {
			this.value = next;
		}
		return result;
	}

	async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T> {
		const { result, next } = await fn(this.value);
		if (next !== undefined) {
			this.value = next;
		}
		return result;
	}
}

/**
 * Credential storage backed by a JSON file.
 */
export class AuthStorage {
	private data: AuthStorageData = {};
	private runtimeOverrides: Map<string, string> = new Map();
	private staleAuthSources: Map<string, AuthSourceToken[]> = new Map();
	private fallbackResolver?: (provider: string) => string | undefined;
	private loadError: Error | null = null;
	private errors: Error[] = [];

	private constructor(
		private storage: AuthStorageBackend,
		_options: AuthStorageOptions = {},
	) {
		this.reload();
	}

	static create(authPath?: string, options?: AuthStorageOptions): AuthStorage {
		const authOptions = options ?? { useXenonCliConfig: authPath === undefined };
		return new AuthStorage(new FileAuthStorageBackend(authPath ?? join(getAgentDir(), "auth.json")), authOptions);
	}

	static fromStorage(storage: AuthStorageBackend, options?: AuthStorageOptions): AuthStorage {
		return new AuthStorage(storage, options);
	}

	static inMemory(data: AuthStorageData = {}, options?: AuthStorageOptions): AuthStorage {
		const storage = new InMemoryAuthStorageBackend();
		storage.withLock(() => ({ result: undefined, next: JSON.stringify(data, null, 2) }));
		return AuthStorage.fromStorage(storage, options);
	}

	/**
	 * Set a runtime API key override (not persisted to disk).
	 * Used for CLI --api-key flag.
	 */
	setRuntimeApiKey(provider: string, apiKey: string): void {
		this.clearStaleAuthSource(provider, "runtime");
		this.runtimeOverrides.set(provider, apiKey);
	}

	/**
	 * Remove a runtime API key override.
	 */
	removeRuntimeApiKey(provider: string): void {
		this.clearStaleAuthSource(provider, "runtime");
		this.runtimeOverrides.delete(provider);
	}

	/**
	 * Set a fallback resolver for API keys not found in auth.json or env vars.
	 * Used for custom provider keys from models.json.
	 */
	setFallbackResolver(resolver: (provider: string) => string | undefined): void {
		this.fallbackResolver = resolver;
	}

	private recordError(error: unknown): void {
		const normalizedError = error instanceof Error ? error : new Error(String(error));
		this.errors.push(normalizedError);
	}

	private fingerprintAuthSource(source: ActiveAuthStatusSource, material: string): string {
		const digest = createHash("sha256").update(source).update("\0").update(material).digest("hex");
		return `${source}:${digest}`;
	}

	private createAuthSourceCandidate(options: {
		source: ActiveAuthStatusSource;
		configured: boolean;
		identityMaterial: string;
		valueMaterial?: string;
		label?: string;
		resolveValueMaterial?: () => string | undefined;
	}): AuthSourceCandidate {
		return {
			configured: options.configured,
			source: options.source,
			...(options.label ? { label: options.label } : {}),
			identityFingerprint: this.fingerprintAuthSource(options.source, `identity:${options.identityMaterial}`),
			...(options.valueMaterial !== undefined
				? {
						valueFingerprint: this.fingerprintAuthSource(
							options.source,
							`value:${options.identityMaterial}\0${options.valueMaterial}`,
						),
					}
				: {}),
			...(options.resolveValueMaterial
				? {
						resolveValueFingerprint: () => {
							const valueMaterial = options.resolveValueMaterial?.();
							return valueMaterial === undefined
								? undefined
								: this.fingerprintAuthSource(
										options.source,
										`value:${options.identityMaterial}\0${valueMaterial}`,
									);
						},
					}
				: {}),
		};
	}

	private getStoredCredentialValueMaterial(providerId: string, credential: AuthCredential): string | undefined {
		if (credential.type === "api_key") {
			if (credential.key.startsWith("!")) {
				const resolvedKey = resolveConfigValueUncached(credential.key);
				return resolvedKey === undefined ? undefined : `api_key:command:${credential.key}\0${resolvedKey}`;
			}
			return `api_key:${credential.key}\0${resolveConfigValue(credential.key) ?? ""}`;
		}
		const provider = getOAuthProvider(providerId);
		const apiKey = provider?.getApiKey(credential) ?? credential.access;
		return `oauth:${apiKey}\0${credential.refresh}\0${credential.expires}`;
	}

	private getStoredCredential(provider: string): AuthCredential | undefined {
		this.reload();
		const canonical = normalizeProviderId(provider);
		let cred: AuthCredential | undefined;
		if (canonical === "nvidia-nim") {
			cred =
				this.data["nvidia-nim"] ??
				this.data.nvidia ??
				this.data["NVIDIA NIM"] ??
				this.data.nvidia_nim ??
				this.data.NVIDIA;
		} else {
			cred = this.data[canonical] ?? this.data[provider];
		}
		if (cred && cred.type === "api_key" && typeof cred.key === "string" && !cred.key.startsWith("!")) {
			return {
				...cred,
				key: cred.key
					.trim()
					.replace(/^["']|["']$/g, "")
					.trim(),
			};
		}
		return cred;
	}

	private getRuntimeAuthCandidate(provider: string): AuthSourceCandidate | undefined {
		const canonical = normalizeProviderId(provider);
		let apiKey = this.runtimeOverrides.get(canonical) ?? this.runtimeOverrides.get(provider);
		if (!apiKey && canonical === "nvidia-nim") {
			apiKey =
				this.runtimeOverrides.get("nvidia-nim") ??
				this.runtimeOverrides.get("nvidia") ??
				this.runtimeOverrides.get("NVIDIA NIM") ??
				this.runtimeOverrides.get("nvidia_nim") ??
				this.runtimeOverrides.get("NVIDIA");
		}
		if (!apiKey) {
			return undefined;
		}
		return {
			label: "--api-key",
			...this.createAuthSourceCandidate({
				configured: false,
				source: "runtime",
				identityMaterial: canonical,
				valueMaterial: apiKey
					.trim()
					.replace(/^["']|["']$/g, "")
					.trim(),
			}),
		};
	}

	private getStoredAuthCandidate(
		provider: string,
		options?: { resolveCommandValue?: boolean; resolvedCommandValue?: string },
	): AuthSourceCandidate | undefined {
		const canonical = normalizeProviderId(provider);
		const credential = this.getStoredCredential(canonical);
		if (!credential) {
			return undefined;
		}
		const isCommandApiKey = credential.type === "api_key" && credential.key.startsWith("!");
		const identityMaterial = isCommandApiKey
			? `api_key:command:${credential.key}`
			: `${canonical}:${credential.type}`;
		const commandValueMaterial =
			isCommandApiKey && options?.resolvedCommandValue !== undefined
				? `api_key:command:${credential.key}\0${options.resolvedCommandValue}`
				: undefined;
		return this.createAuthSourceCandidate({
			configured: true,
			source: "stored",
			identityMaterial,
			valueMaterial:
				commandValueMaterial ??
				(isCommandApiKey && !options?.resolveCommandValue
					? undefined
					: this.getStoredCredentialValueMaterial(canonical, credential)),
			resolveValueMaterial: isCommandApiKey
				? () => this.getStoredCredentialValueMaterial(canonical, credential)
				: undefined,
		});
	}

	private getEnvironmentAuthCandidate(provider: string): AuthSourceCandidate | undefined {
		const canonical = normalizeProviderId(provider);
		const envKeys = findEnvKeys(canonical);
		const envKey = envKeys?.[0];
		const apiKey = getEnvApiKey(canonical);
		if (!apiKey) {
			return undefined;
		}
		const label = envKey ?? "ambient credentials";
		const identityMaterial = envKey ?? this.getAmbientEnvironmentIdentityMaterial(canonical);
		return this.createAuthSourceCandidate({
			configured: false,
			source: "environment",
			label,
			identityMaterial,
			valueMaterial: `${identityMaterial}\0${apiKey
				.trim()
				.replace(/^["']|["']$/g, "")
				.trim()}`,
		});
	}

	private getAmbientEnvironmentIdentityMaterial(provider: string): string {
		if (provider === "amazon-bedrock") {
			if (process.env.AWS_PROFILE) return `amazon-bedrock:profile:${process.env.AWS_PROFILE}`;
			if (process.env.AWS_ACCESS_KEY_ID) {
				return `amazon-bedrock:access-key:${process.env.AWS_ACCESS_KEY_ID}:${process.env.AWS_SECRET_ACCESS_KEY ?? ""}:${process.env.AWS_SESSION_TOKEN ?? ""}`;
			}
			if (process.env.AWS_BEARER_TOKEN_BEDROCK) {
				return `amazon-bedrock:bearer:${process.env.AWS_BEARER_TOKEN_BEDROCK}`;
			}
			if (process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI) {
				return `amazon-bedrock:ecs-relative:${process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI}`;
			}
			if (process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI) {
				return `amazon-bedrock:ecs-full:${process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI}`;
			}
			if (process.env.AWS_WEB_IDENTITY_TOKEN_FILE) {
				return `amazon-bedrock:web-identity:${process.env.AWS_WEB_IDENTITY_TOKEN_FILE}`;
			}
		}
		if (provider === "google-vertex") {
			const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? "";
			const location = process.env.GOOGLE_CLOUD_LOCATION ?? "";
			const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "application-default";
			return `google-vertex:${project}:${location}:${credentialsPath}`;
		}
		return provider;
	}

	private getFallbackAuthCandidate(provider: string): AuthSourceCandidate | undefined {
		const apiKey = this.fallbackResolver?.(provider);
		if (!apiKey) {
			return undefined;
		}
		return this.createAuthSourceCandidate({
			configured: false,
			source: "fallback",
			label: "custom provider config",
			identityMaterial: provider,
			valueMaterial: apiKey,
		});
	}

	private getAuthSourceCandidates(provider: string, options?: { includeFallback?: boolean }): AuthSourceCandidate[] {
		const fallbackCandidate =
			options?.includeFallback === false ? undefined : this.getFallbackAuthCandidate(provider);
		const candidates = [
			this.getRuntimeAuthCandidate(provider),
			this.getStoredAuthCandidate(provider),
			this.getEnvironmentAuthCandidate(provider),
			fallbackCandidate,
		];
		return candidates.filter((candidate): candidate is AuthSourceCandidate => candidate !== undefined);
	}

	private isAuthSourceStale(provider: string, candidate: AuthSourceCandidate): boolean {
		const matchingStale = this.getMatchingStaleAuthSources(provider, candidate);
		if (matchingStale.length === 0) {
			return false;
		}
		const valueFingerprint = candidate.valueFingerprint ?? candidate.resolveValueFingerprint?.();
		return Boolean(valueFingerprint && matchingStale.some((token) => token.valueFingerprint === valueFingerprint));
	}

	private getMatchingStaleAuthSources(provider: string, candidate: AuthSourceCandidate): AuthSourceToken[] {
		const stale = this.staleAuthSources.get(provider);
		if (!stale) {
			return [];
		}
		return stale.filter(
			(token) => token.source === candidate.source && token.identityFingerprint === candidate.identityFingerprint,
		);
	}

	private getAvailableAuthCandidate(
		provider: string,
		options?: { includeFallback?: boolean },
	): { candidate?: AuthSourceCandidate; hasStaleCandidate: boolean } {
		let hasStaleCandidate = false;
		for (const candidate of this.getAuthSourceCandidates(provider, options)) {
			if (this.isAuthSourceStale(provider, candidate)) {
				hasStaleCandidate = true;
				continue;
			}
			return { candidate, hasStaleCandidate };
		}
		return { hasStaleCandidate };
	}

	private toAuthStatus(candidate: AuthSourceCandidate): AuthStatus {
		return {
			configured: candidate.configured,
			source: candidate.source,
			...(candidate.label ? { label: candidate.label } : {}),
		};
	}

	private getAuthStatusFromCandidates(provider: string): AuthStatus {
		const { candidate, hasStaleCandidate } = this.getAvailableAuthCandidate(provider);
		if (candidate) {
			return this.toAuthStatus(candidate);
		}
		if (hasStaleCandidate) {
			return { configured: false, source: "stale", label: "expired" };
		}
		return { configured: false };
	}

	markAuthStale(provider: string): boolean {
		const token = this.getCurrentAuthSourceToken(provider);
		return token ? this.markAuthSourceStale(token) : false;
	}

	private getAuthSourceTokenForCandidate(
		provider: string,
		candidate: AuthSourceCandidate,
	): AuthSourceToken | undefined {
		const valueFingerprint = candidate.valueFingerprint ?? candidate.resolveValueFingerprint?.();
		if (!valueFingerprint) {
			return undefined;
		}
		return {
			provider,
			source: candidate.source,
			identityFingerprint: candidate.identityFingerprint,
			valueFingerprint,
		};
	}

	getCurrentAuthSourceToken(provider: string): AuthSourceToken | undefined {
		const { candidate } = this.getAvailableAuthCandidate(provider);
		if (!candidate) {
			return undefined;
		}
		return this.getAuthSourceTokenForCandidate(provider, candidate);
	}

	markAuthSourceStale(token: AuthSourceToken): boolean {
		if (token.provider.length === 0) {
			return false;
		}
		const stale = this.staleAuthSources.get(token.provider) ?? [];
		if (
			!stale.some(
				(existing) =>
					existing.source === token.source &&
					existing.identityFingerprint === token.identityFingerprint &&
					existing.valueFingerprint === token.valueFingerprint,
			)
		) {
			stale.push(token);
		}
		this.staleAuthSources.set(token.provider, stale);
		return true;
	}

	private clearStaleAuthSource(provider: string, source: ActiveAuthStatusSource): void {
		const stale = this.staleAuthSources.get(provider);
		if (!stale) {
			return;
		}
		const next = stale.filter((token) => token.source !== source);
		if (next.length === 0) {
			this.staleAuthSources.delete(provider);
		} else {
			this.staleAuthSources.set(provider, next);
		}
	}

	private parseStorageData(content: string | undefined): AuthStorageData {
		if (!content) {
			return {};
		}
		return JSON.parse(content) as AuthStorageData;
	}

	/**
	 * Reload credentials from storage.
	 */
	reload(): void {
		let content: string | undefined;
		try {
			this.storage.withLock((current) => {
				content = current;
				return { result: undefined };
			});
			this.data = this.parseStorageData(content);
			this.loadError = null;
		} catch (error) {
			this.loadError = error as Error;
			this.recordError(error);
		}
	}

	private persistProviderChange(provider: string, credential: AuthCredential | undefined): void {
		if (this.loadError) {
			return;
		}

		try {
			this.storage.withLock((current) => {
				const currentData = this.parseStorageData(current);
				const merged: AuthStorageData = { ...currentData };
				if (credential) {
					merged[provider] = credential;
				} else {
					delete merged[provider];
				}
				return { result: undefined, next: JSON.stringify(merged, null, 2) };
			});
		} catch (error) {
			this.recordError(error);
		}
	}

	/**
	 * Get credential for a provider.
	 */
	get(provider: string): AuthCredential | undefined {
		return this.getStoredCredential(provider);
	}

	/**
	 * Set credential for a provider.
	 */
	set(provider: string, credential: AuthCredential): void {
		const targetProvider = normalizeProviderId(provider);
		if (credential.type === "api_key" && typeof credential.key === "string" && !credential.key.startsWith("!")) {
			credential = {
				...credential,
				key: credential.key
					.trim()
					.replace(/^["']|["']$/g, "")
					.trim(),
			};
		}
		this.clearStaleAuthSource(targetProvider, "stored");
		this.data[targetProvider] = credential;
		this.persistProviderChange(targetProvider, credential);
	}

	/**
	 * Remove credential for a provider.
	 */
	remove(provider: string): void {
		const targetProvider = normalizeProviderId(provider);
		this.clearStaleAuthSource(targetProvider, "stored");
		delete this.data[targetProvider];
		if (targetProvider === "nvidia-nim") {
			delete this.data.nvidia;
			delete this.data["NVIDIA NIM"];
			delete this.data.nvidia_nim;
			delete this.data.NVIDIA;
		}
		this.persistProviderChange(targetProvider, undefined);
	}

	/**
	 * Remove a provider's credential with the disk write verified: throws on any
	 * load or write failure instead of recording it, so callers can refuse to
	 * proceed while the credential may still exist on disk. Disk-authoritative
	 * and idempotent — in-memory state is only updated after the write succeeds.
	 */
	removeVerified(provider: string): void {
		const targetProvider = normalizeProviderId(provider);
		this.storage.withLock((current) => {
			const currentData = this.parseStorageData(current);
			if (!(targetProvider in currentData) && !(provider in currentData)) return { result: undefined };
			const merged: AuthStorageData = { ...currentData };
			delete merged[targetProvider];
			delete merged[provider];
			if (targetProvider === "nvidia-nim") {
				delete merged.nvidia;
				delete merged["NVIDIA NIM"];
				delete merged.nvidia_nim;
				delete merged.NVIDIA;
			}
			return { result: undefined, next: JSON.stringify(merged, null, 2) };
		});
		delete this.data[targetProvider];
		delete this.data[provider];
		if (targetProvider === "nvidia-nim") {
			delete this.data.nvidia;
			delete this.data["NVIDIA NIM"];
			delete this.data.nvidia_nim;
			delete this.data.NVIDIA;
		}
		// Post-success only: a failed removal must not make a stale-marked credential selectable again.
		this.clearStaleAuthSource(targetProvider, "stored");
	}

	/**
	 * List all providers with credentials.
	 */
	list(): string[] {
		this.reload();
		return Object.keys(this.data);
	}

	/**
	 * Check if credentials exist for a provider in auth.json.
	 */
	has(provider: string): boolean {
		return this.getStoredCredential(provider) !== undefined;
	}

	/**
	 * Check if any form of auth is configured for a provider.
	 * Unlike getApiKey(), this doesn't refresh OAuth tokens.
	 */
	hasAuth(provider: string): boolean {
		return this.getAvailableAuthCandidate(provider).candidate !== undefined;
	}

	/**
	 * Return auth status without exposing credential values or refreshing tokens.
	 */
	getAuthStatus(provider: string): AuthStatus {
		return this.getAuthStatusFromCandidates(provider);
	}

	/**
	 * Get all credentials (for passing to getOAuthApiKey).
	 */
	getAll(): AuthStorageData {
		return { ...this.data };
	}

	drainErrors(): Error[] {
		const drained = [...this.errors];
		this.errors = [];
		return drained;
	}

	/**
	 * Clear recorded error for a provider (e.g. after successful auth)
	 */
	clearError(_provider: string): void {
		this.errors = [];
	}

	/**
	 * Check if there were any errors loading credentials.
	 */
	getLoadError(): Error | null {
		return this.loadError;
	}

	/**
	 * Get all errors that occurred during credential operations.
	 */
	getErrors(): Error[] {
		return [...this.errors];
	}

	/**
	 * Login to an OAuth provider.
	 */
	async login(providerId: OAuthProviderId, callbacks: OAuthLoginCallbacks): Promise<void> {
		const provider = getOAuthProvider(providerId);
		if (!provider) {
			throw new Error(`Unknown OAuth provider: ${providerId}`);
		}

		const credentials = await provider.login(callbacks);
		this.set(providerId, { type: "oauth", ...credentials });
	}

	/**
	 * Log out of a provider by removing its credentials from auth.json.
	 */
	logout(provider: string): void {
		this.removeVerified(provider);
	}

	/**
	 * Internal token refresh that handles file locking.
	 */
	private async refreshOAuthTokenWithLock(providerId: string): Promise<{ apiKey: string } | null> {
		const result = await this.storage.withLockAsync<{ apiKey: string } | null>(async (current) => {
			const currentData = this.parseStorageData(current);
			const cred = currentData[providerId];

			if (!cred || cred.type !== "oauth") {
				return { result: null };
			}

			// If another instance already refreshed the token, use that.
			if (Date.now() < cred.expires) {
				const provider = getOAuthProvider(providerId);
				if (!provider) {
					return { result: null };
				}
				this.data = currentData;
				this.loadError = null;
				return { result: { apiKey: provider.getApiKey(cred) } };
			}

			// Refresh the token.
			const provider = getOAuthProvider(providerId);
			if (!provider) {
				return { result: null };
			}

			const refreshed = await provider.refreshToken(cred);
			const refreshedCred: OAuthCredential = {
				type: "oauth",
				...refreshed,
			};
			const merged: AuthStorageData = {
				...currentData,
				[providerId]: refreshedCred,
			};

			this.data = merged;
			this.loadError = null;
			return {
				result: { apiKey: provider.getApiKey(refreshedCred) },
				next: JSON.stringify(merged, null, 2),
			};
		});

		return result;
	}

	/**
	 * Get API key for a provider.
	 * Priority:
	 * 1. Runtime override (CLI --api-key)
	 * 2. Xenon Inference: environment variable, Xenon CLI config, auth.json
	 * 3. Other providers: auth.json, environment variable
	 * 4. Fallback resolver (models.json custom providers)
	 */
	async getApiKeyWithSourceToken(
		providerId: string,
		options?: { includeFallback?: boolean },
	): Promise<AuthApiKeyResult> {
		const canonical = normalizeProviderId(providerId);
		// Runtime overrides take precedence over stored credentials and environment keys.
		const runtimeCandidate = this.getRuntimeAuthCandidate(canonical);
		let runtimeKey = this.runtimeOverrides.get(canonical) ?? this.runtimeOverrides.get(providerId);
		if (!runtimeKey && canonical === "nvidia-nim") {
			runtimeKey =
				this.runtimeOverrides.get("nvidia-nim") ??
				this.runtimeOverrides.get("nvidia") ??
				this.runtimeOverrides.get("NVIDIA NIM") ??
				this.runtimeOverrides.get("nvidia_nim") ??
				this.runtimeOverrides.get("NVIDIA");
		}
		if (runtimeKey && runtimeCandidate && !this.isAuthSourceStale(canonical, runtimeCandidate)) {
			const trimmedKey = runtimeKey
				.trim()
				.replace(/^["']|["']$/g, "")
				.trim();
			return {
				apiKey: trimmedKey,
				sourceToken: this.getAuthSourceTokenForCandidate(canonical, runtimeCandidate),
			};
		}

		const cred = this.getStoredCredential(canonical);

		if (cred?.type === "api_key") {
			const storedCandidate = this.getStoredAuthCandidate(canonical);
			if (storedCandidate && !this.isAuthSourceStale(canonical, storedCandidate)) {
				const hasStaleRecord = this.getMatchingStaleAuthSources(canonical, storedCandidate).length > 0;
				const apiKey =
					cred.key.startsWith("!") && hasStaleRecord
						? resolveConfigValueUncached(cred.key)
						: resolveConfigValue(cred.key);
				const trimmedApiKey =
					apiKey !== undefined
						? apiKey
								.trim()
								.replace(/^["']|["']$/g, "")
								.trim()
						: undefined;
				const sourceToken =
					trimmedApiKey === undefined
						? undefined
						: this.getAuthSourceTokenForCandidate(
								canonical,
								cred.key.startsWith("!")
									? (this.getStoredAuthCandidate(canonical, { resolvedCommandValue: trimmedApiKey }) ??
											storedCandidate)
									: storedCandidate,
							);
				return { apiKey: trimmedApiKey, sourceToken };
			}
		}

		if (cred?.type === "oauth") {
			const storedCandidate = this.getStoredAuthCandidate(canonical);
			if (storedCandidate && !this.isAuthSourceStale(canonical, storedCandidate)) {
				const provider = getOAuthProvider(canonical);
				if (!provider) {
					return {};
				}
				// Lock refreshes so concurrent instances cannot race on the credential file.
				const needsRefresh = Date.now() >= cred.expires;

				if (needsRefresh) {
					try {
						const result = await this.refreshOAuthTokenWithLock(canonical);
						if (result) {
							const refreshedCandidate = this.getStoredAuthCandidate(canonical);
							return {
								apiKey: result.apiKey,
								sourceToken: refreshedCandidate
									? this.getAuthSourceTokenForCandidate(canonical, refreshedCandidate)
									: undefined,
							};
						}
					} catch (error) {
						this.recordError(error);
						// A peer may have refreshed successfully; reload before treating this refresh as failed.
						this.reload();
						const updatedCred = this.getStoredCredential(canonical);

						if (updatedCred?.type === "oauth" && Date.now() < updatedCred.expires) {
							const updatedCandidate = this.getStoredAuthCandidate(canonical);
							return {
								apiKey: provider.getApiKey(updatedCred),
								sourceToken: updatedCandidate
									? this.getAuthSourceTokenForCandidate(canonical, updatedCandidate)
									: undefined,
							};
						}

						// Preserve credentials for a later /login retry while discovery skips this provider.
						return {};
					}
				} else {
					return {
						apiKey: provider.getApiKey(cred),
						sourceToken: this.getAuthSourceTokenForCandidate(canonical, storedCandidate),
					};
				}
			}
		}

		const envCandidate = this.getEnvironmentAuthCandidate(canonical);
		const envKey = getEnvApiKey(canonical);
		if (envKey && envCandidate && !this.isAuthSourceStale(canonical, envCandidate)) {
			const trimmedEnvKey = envKey
				.trim()
				.replace(/^["']|["']$/g, "")
				.trim();
			return {
				apiKey: trimmedEnvKey,
				sourceToken: this.getAuthSourceTokenForCandidate(canonical, envCandidate),
			};
		}
		if (options?.includeFallback !== false) {
			const fallbackCandidate = this.getFallbackAuthCandidate(canonical);
			if (fallbackCandidate && !this.isAuthSourceStale(canonical, fallbackCandidate)) {
				const fallbackKey = this.fallbackResolver?.(canonical) ?? this.fallbackResolver?.(providerId);
				const trimmedFallbackKey =
					fallbackKey !== undefined
						? fallbackKey
								.trim()
								.replace(/^["']|["']$/g, "")
								.trim()
						: undefined;
				return {
					apiKey: trimmedFallbackKey,
					sourceToken: this.getAuthSourceTokenForCandidate(canonical, fallbackCandidate),
				};
			}
		}

		return {};
	}

	async getApiKey(providerId: string, options?: { includeFallback?: boolean }): Promise<string | undefined> {
		const result = await this.getApiKeyWithSourceToken(providerId, options);
		return result.apiKey;
	}

	/**
	 * Get all registered OAuth providers
	 */
	getOAuthProviders() {
		return getOAuthProviders();
	}

	getProviderHeaders(_providerId: string): Record<string, string> | undefined {
		return undefined;
	}
}
