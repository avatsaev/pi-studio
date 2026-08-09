import { join } from "node:path";

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { GlobalOptions } from "./cli-core.js";

/**
 * Pi auth engine seam (features/provider-auth-cli.md § Public Contract / § Behavior & Algorithms).
 * Wraps `@earendil-works/pi-coding-agent`'s `ModelRuntime` — the same auth engine the daemon-spawned
 * `pi --mode rpc` process uses — behind a small structural interface so command modules never touch
 * Pi types directly and tests never need a Pi import. The Pi package is loaded **lazily**, on first
 * method call, so unrelated commands (and `--help`) never pay for its module graph.
 */

/** Resolved `auth.json`/`models.json` paths; `undefined` fields let Pi's own defaults decide. */
export interface PiAuthPaths {
  authPath?: string;
  modelsPath?: string;
}

/**
 * Derive the auth/models paths from `--pi-home` / `PI_STUDIO_PI_HOME`, exactly mirroring
 * `piProxyEnv()` (this file's sibling for the `pi` passthrough) and the daemon's `piHomeEnv()`
 * (`packages/server/src/agent/provider-registry.ts:57` — module-private there, so this is a
 * parallel literal derivation, not an import: `join(piHome, "agent", "auth.json")`). Path parity
 * with that derivation is the whole point of this seam: a credential the CLI writes here must be
 * the one a daemon-spawned agent reads.
 */
export function resolvePiAuthPaths(opts: GlobalOptions, env = process.env): PiAuthPaths {
  const piHome = opts.piHome ?? env.PI_STUDIO_PI_HOME;
  if (!piHome) return {};
  const agentDir = join(piHome, "agent");
  return {
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  };
}

/** A provider that can be authenticated, filtered to ones that actually support a login flow. */
export interface AuthProviderInfo {
  id: string;
  name: string;
  canApiKeyLogin: boolean;
  canOAuthLogin: boolean;
  oauthLoginLabel?: string;
  oauthIsSubscription?: boolean;
}

/** Current auth state for one provider. */
export interface AuthStatusInfo {
  configured: boolean;
  type?: "api_key" | "oauth";
  source?: string;
}

/**
 * Local structural mirror of pi-ai's `AuthInteraction` (not exported from
 * `@earendil-works/pi-coding-agent`'s main entry, hence declared here). `runtime.login()` accepts
 * any object shaped like this — TypeScript checks it structurally, no Pi type import needed.
 */
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
  prompt(p: AuthPromptLike): Promise<string>;
  notify(e: AuthEventLike): void;
}

/** The injectable seam. `CliContext.auth` carries this (or a test fake). */
export interface AuthRuntime {
  listProviders(): Promise<AuthProviderInfo[]>;
  checkAuth(providerId: string): Promise<AuthStatusInfo>;
  login(
    providerId: string,
    type: "api_key" | "oauth",
    interaction: AuthInteractionLike,
  ): Promise<{ type: string }>;
  logout(providerId: string): Promise<void>;
  /** Resolved `auth.json` path, for success/status messages. */
  authPathLabel(): string;
}

/**
 * Default production `AuthRuntime`. Creates Pi's `ModelRuntime` once, lazily, on the first method
 * call — never at module load or construction time — and caches the promise so repeated calls
 * reuse the same instance.
 */
export function defaultAuthRuntime(paths: PiAuthPaths): AuthRuntime {
  let runtimePromise: Promise<ModelRuntime> | null = null;

  // Deliberate `await import()`, not a static import: `@earendil-works/pi-coding-agent`'s main
  // entry pulls in its whole TUI module graph, which would tax `pi-studio --help` and every
  // unrelated command. Deferring to first actual use (task-001 acceptance criterion) is the whole
  // point of this seam — see `swe/features/provider-auth-cli.md` § Behavior & Algorithms.
  async function getRuntime(): Promise<ModelRuntime> {
    if (!runtimePromise) {
      runtimePromise = (async () => {
        const { ModelRuntime: ModelRuntimeCtor } = await import("@earendil-works/pi-coding-agent");
        return ModelRuntimeCtor.create({
          authPath: paths.authPath,
          modelsPath: paths.modelsPath,
          refreshOnCreate: false,
        });
      })();
    }
    return runtimePromise;
  }

  return {
    async listProviders() {
      const runtime = await getRuntime();
      const out: AuthProviderInfo[] = [];
      for (const p of runtime.getProviders()) {
        try {
          const canApiKeyLogin = p.auth?.apiKey?.login !== undefined;
          const canOAuthLogin = p.auth?.oauth !== undefined;
          if (!canApiKeyLogin && !canOAuthLogin) continue;
          out.push({
            id: p.id,
            name: p.name,
            canApiKeyLogin,
            canOAuthLogin,
            oauthLoginLabel: p.auth?.oauth?.loginLabel,
            oauthIsSubscription: p.auth?.oauth?.isSubscription,
          });
        } catch {
          // Malformed provider entry (e.g. missing/unexpected shape) — skip it, never let one
          // bad provider take down the whole listing.
        }
      }
      return out;
    },

    async checkAuth(providerId) {
      const runtime = await getRuntime();
      const check = await runtime.checkAuth(providerId);
      if (!check) return { configured: false };
      return { configured: true, type: check.type, source: check.source };
    },

    async login(providerId, type, interaction) {
      const runtime = await getRuntime();
      return runtime.login(providerId, type, interaction);
    },

    async logout(providerId) {
      const runtime = await getRuntime();
      await runtime.logout(providerId);
    },

    authPathLabel() {
      return paths.authPath ?? "<default Pi auth path>";
    },
  };
}
