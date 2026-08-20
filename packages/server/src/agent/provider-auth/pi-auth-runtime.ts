import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { PiAuthPaths } from "../pi-home.js";

/**
 * Daemon-side seam onto Pi's `ModelRuntime` auth engine (swe/features/provider-auth-rpc.md § New/
 * changed files, § Behavior & Algorithms — runtime bullet). This is the daemon's sibling of
 * `packages/cli/src/auth-runtime.ts`'s `AuthRuntime` — deliberately not shared (different package,
 * different owner this sprint) but structurally the same idea: hide `ModelRuntime` behind a small
 * interface so the flow service (task-003) and its tests never import a Pi type directly.
 *
 * **Lazy `import()` here is not a startup optimization.** The daemon already statically imports
 * `@earendil-works/pi-coding-agent` (`agent/providers/pi/session-hydration.ts` imports
 * `SessionManager`), so the module graph is already paid for. It is lazy so a daemon whose Pi auth
 * runtime cannot be constructed (e.g. a corrupt `auth.json`) still boots and serves every other
 * RPC, failing only this family — and so construction is *retried* on the next call rather than
 * poisoning the service for the daemon's lifetime.
 */

// ---------------------------------------------------------------------------
// Structural mirrors of pi-ai's AuthPrompt / AuthEvent / AuthInteraction
// (`@earendil-works/pi-ai`'s `auth/types.ts`, not exported from
// `@earendil-works/pi-coding-agent`'s main entry). Declared locally so no call site imports a Pi
// type; `runtime.login()` accepts any object shaped like `AuthInteractionLike` — TypeScript checks
// structurally.
// ---------------------------------------------------------------------------

export interface AuthPromptTextLike {
  signal?: AbortSignal;
  type: "text";
  message: string;
  placeholder?: string;
}
export interface AuthPromptSecretLike {
  signal?: AbortSignal;
  type: "secret";
  message: string;
  placeholder?: string;
}
export interface AuthPromptSelectLike {
  signal?: AbortSignal;
  type: "select";
  message: string;
  options: readonly { id: string; label: string; description?: string }[];
}
export interface AuthPromptManualCodeLike {
  signal?: AbortSignal;
  type: "manual_code";
  message: string;
  placeholder?: string;
}
export type AuthPromptLike =
  | AuthPromptTextLike
  | AuthPromptSecretLike
  | AuthPromptSelectLike
  | AuthPromptManualCodeLike;

export interface AuthEventInfoLike {
  type: "info";
  message: string;
  links?: readonly { url: string; label?: string }[];
}
export interface AuthEventAuthUrlLike {
  type: "auth_url";
  url: string;
  instructions?: string;
}
export interface AuthEventDeviceCodeLike {
  type: "device_code";
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
}
export interface AuthEventProgressLike {
  type: "progress";
  message: string;
}
export type AuthEventLike =
  | AuthEventInfoLike
  | AuthEventAuthUrlLike
  | AuthEventDeviceCodeLike
  | AuthEventProgressLike;

export interface AuthInteractionLike {
  signal?: AbortSignal;
  prompt(prompt: AuthPromptLike): Promise<string>;
  notify(event: AuthEventLike): void;
}

// ---------------------------------------------------------------------------
// PiAuthRuntime
// ---------------------------------------------------------------------------

/** A login-capable provider, before any auth-state check (that is {@link PiAuthCheckResult}, a
 *  separate bounded call — `listProviders()` never blocks on it). */
export interface PiAuthProviderInfo {
  id: string;
  name: string;
  authTypes: ("api_key" | "oauth")[];
  oauthLoginLabel?: string;
  oauthIsSubscription?: boolean;
}

/** `configured: "unknown"` means the bounded probe exceeded its timeout (sprint-054's
 *  `checkAuthBounded` precedent — some ambient checks, e.g. an AWS-profile or ADC-file probe, can
 *  hang). Never conflate `"unknown"` with `false`: the caller must not report a credential absent
 *  when it simply could not be confirmed in time. */
export interface PiAuthCheckResult {
  configured: boolean | "unknown";
  type?: "api_key" | "oauth";
  source?: string;
}

export interface PiAuthRuntime {
  listProviders(): Promise<PiAuthProviderInfo[]>;
  checkAuth(providerId: string): Promise<PiAuthCheckResult>;
  /** `signal` is the caller's flow-wide `AbortController.signal` (task-003) — merged onto the
   *  interaction so Pi's own `interaction.signal` race (login rejects with Pi's generic
   *  `AbortError` on abort) works whether or not the caller-supplied `interaction` already carries
   *  one. */
  login(
    providerId: string,
    authType: "api_key" | "oauth",
    interaction: AuthInteractionLike,
    signal?: AbortSignal,
  ): Promise<{ type: "api_key" | "oauth" }>;
  /** Re-checks after removal so the caller can report an ambient credential (e.g. an env var)
   *  surviving the logout, rather than silently claiming success. */
  logout(providerId: string): Promise<{ stillConfigured: boolean }>;
  /** Resolved `auth.json` path, for status/log messages — never the credential itself. */
  authPathLabel(): string;
}

/** Bound for {@link PiAuthRuntime.checkAuth}; overridable per-instance for tests (fake timers). */
export const DEFAULT_CHECK_AUTH_TIMEOUT_MS = 3000;

export interface CreatePiAuthRuntimeOptions {
  checkAuthTimeoutMs?: number;
}

/**
 * Production `PiAuthRuntime`. Creates Pi's `ModelRuntime` once, lazily, on the first method call —
 * never at module load or construction time — and caches the promise so repeated calls reuse the
 * same instance. On a failed construction the cached promise is cleared so the *next* call retries
 * rather than the daemon staying poisoned until restart.
 */
export function createPiAuthRuntime(
  paths: PiAuthPaths,
  opts?: CreatePiAuthRuntimeOptions,
): PiAuthRuntime {
  const checkAuthTimeoutMs = opts?.checkAuthTimeoutMs ?? DEFAULT_CHECK_AUTH_TIMEOUT_MS;
  let runtimePromise: Promise<ModelRuntime> | null = null;

  // Deliberate `await import()`, not a static import — see the module-level doc comment.
  function getRuntime(): Promise<ModelRuntime> {
    if (!runtimePromise) {
      const promise = (async () => {
        // Deliberate `await import()`, not a static import: deferring past module load lets a
        // daemon whose Pi auth runtime cannot construct still boot and serve every other RPC (see
        // the module-level doc comment) — the module specifier is fixed, but the *timing* is the
        // point, not a runtime-selected path.
        const { ModelRuntime: ModelRuntimeCtor } = await import("@earendil-works/pi-coding-agent");
        return ModelRuntimeCtor.create({
          authPath: paths.authPath,
          modelsPath: paths.modelsPath,
          refreshOnCreate: false,
        });
      })();
      runtimePromise = promise;
      // A transient failure (e.g. a momentarily-locked auth.json) must not poison every later
      // call — clear the cache so the next getRuntime() retries construction from scratch.
      promise.catch(() => {
        if (runtimePromise === promise) runtimePromise = null;
      });
    }
    return runtimePromise;
  }

  async function checkAuth(providerId: string): Promise<PiAuthCheckResult> {
    const runtime = await getRuntime();
    const { promise: timeout, resolve: resolveTimeout } = Promise.withResolvers<"unknown">();
    const timer = setTimeout(() => resolveTimeout("unknown"), checkAuthTimeoutMs);
    try {
      const result = await Promise.race([runtime.checkAuth(providerId), timeout]);
      if (result === "unknown") return { configured: "unknown" };
      if (!result) return { configured: false };
      return { configured: true, type: result.type, source: result.source };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async listProviders() {
      const runtime = await getRuntime();
      const out: PiAuthProviderInfo[] = [];
      for (const p of runtime.getProviders()) {
        try {
          const canApiKeyLogin = p.auth?.apiKey?.login !== undefined;
          const canOAuthLogin = p.auth?.oauth !== undefined;
          if (!canApiKeyLogin && !canOAuthLogin) continue;
          const authTypes: ("api_key" | "oauth")[] = [];
          if (canApiKeyLogin) authTypes.push("api_key");
          if (canOAuthLogin) authTypes.push("oauth");
          out.push({
            id: p.id,
            name: p.name,
            authTypes,
            oauthLoginLabel: p.auth?.oauth?.loginLabel,
            oauthIsSubscription: p.auth?.oauth?.isSubscription,
          });
        } catch {
          // Malformed provider entry (unexpected shape) — skip it, never let one bad provider
          // take down the whole listing.
        }
      }
      return out;
    },

    checkAuth,

    async login(providerId, authType, interaction, signal) {
      const runtime = await getRuntime();
      const credential = await runtime.login(providerId, authType, {
        ...interaction,
        signal: signal ?? interaction.signal,
      });
      return { type: credential.type };
    },

    async logout(providerId) {
      const runtime = await getRuntime();
      await runtime.logout(providerId);
      const recheck = await checkAuth(providerId);
      return { stillConfigured: recheck.configured === true };
    },

    authPathLabel() {
      return paths.authPath ?? "<default Pi auth path>";
    },
  };
}
