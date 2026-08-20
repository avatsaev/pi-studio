/**
 * Turns a `ProviderAuthInfo` row into what `ModelProvidersPanel` renders — badge label/variant,
 * the auth-type choices to offer, and the login action's label. Pure — the component only binds
 * this to the DOM, matching `connection-presentation.ts`'s split beside `ConnectionBar.tsx`.
 *
 * swe/features/provider-auth-ui.md § Web UI surface.
 */

import type { ProviderAuthInfo, ProviderAuthType } from "@av-pi-studio/protocol";
import type { StatusBadgeVariant } from "@pi-studio-ui/ui/status-badge.js";

export interface ProviderAuthBadge {
  label: string;
  variant: StatusBadgeVariant;
}

const ENV_SOURCE_PREFIX = "env:";

/**
 * `configured` is `boolean | "unknown"` on the wire because the daemon bounds a hanging
 * `checkAuth()` at 3s (sprint-054). `"unknown"` renders as its own muted-but-distinct `warning`
 * badge — never folded into "not configured", which would invite a re-login over a credential
 * that may well still work.
 */
export function providerAuthBadge(provider: ProviderAuthInfo): ProviderAuthBadge {
  if (provider.configured === "unknown") return { label: "Unknown", variant: "warning" };
  if (provider.configured === false) return { label: "Not configured", variant: "muted" };

  if (provider.configuredSource?.startsWith(ENV_SOURCE_PREFIX)) {
    return {
      label: `env: ${provider.configuredSource.slice(ENV_SOURCE_PREFIX.length)}`,
      variant: "success",
    };
  }
  if (provider.configuredType === "oauth") return { label: "OAuth", variant: "success" };
  return { label: "API key", variant: "success" };
}

export interface LoginChoice {
  authType: ProviderAuthType;
  label: string;
}

/**
 * The login action(s) a row offers: one method available goes straight through under a single
 * `Log in`/`Re-login` label; both available offers a choice per method, the OAuth one labeled
 * with the provider's own `oauthLoginLabel` when it supplies one.
 */
export function providerAuthLoginChoices(provider: ProviderAuthInfo): LoginChoice[] {
  const verb = provider.configured === true ? "Re-login" : "Log in";
  if (provider.authTypes.length <= 1) {
    const authType = provider.authTypes[0] ?? "api_key";
    return [{ authType, label: authType === "oauth" ? (provider.oauthLoginLabel ?? verb) : verb }];
  }
  return provider.authTypes.map((authType) =>
    authType === "oauth"
      ? { authType, label: provider.oauthLoginLabel ?? "Log in with OAuth" }
      : { authType, label: "API key" },
  );
}
