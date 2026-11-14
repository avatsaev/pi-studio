import { describe, expect, it } from "vitest";
import type { ProviderAuthInfo } from "@av-pi-studio/protocol";
import { providerAuthBadge, providerAuthLoginChoices } from "./provider-auth-presentation.js";

function provider(overrides: Partial<ProviderAuthInfo> = {}): ProviderAuthInfo {
  return {
    id: "openai",
    name: "OpenAI",
    authTypes: ["api_key"],
    configured: false,
    ...overrides,
  };
}

describe("providerAuthBadge", () => {
  it("renders 'unknown' as its own warning badge, never as configured or unconfigured", () => {
    expect(providerAuthBadge(provider({ configured: "unknown" }))).toEqual({
      label: "Unknown",
      variant: "warning",
    });
  });

  it("renders unconfigured as a muted 'Not configured' badge", () => {
    expect(providerAuthBadge(provider({ configured: false }))).toEqual({
      label: "Not configured",
      variant: "muted",
    });
  });

  it("renders a stored api key as a success 'API key' badge", () => {
    expect(providerAuthBadge(provider({ configured: true, configuredType: "api_key" }))).toEqual({
      label: "API key",
      variant: "success",
    });
  });

  it("renders a stored oauth credential as a success 'OAuth' badge", () => {
    expect(
      providerAuthBadge(
        provider({ configured: true, configuredType: "oauth", authTypes: ["oauth"] }),
      ),
    ).toEqual({ label: "OAuth", variant: "success" });
  });

  it("renders an ambient env-sourced credential as 'env: VAR', taking priority over configuredType", () => {
    expect(
      providerAuthBadge(
        provider({
          configured: true,
          configuredType: "api_key",
          configuredSource: "env:ANTHROPIC_API_KEY",
        }),
      ),
    ).toEqual({ label: "env: ANTHROPIC_API_KEY", variant: "success" });
  });
});

describe("providerAuthLoginChoices", () => {
  it("a single api_key method offers one 'Log in' choice", () => {
    expect(providerAuthLoginChoices(provider({ authTypes: ["api_key"] }))).toEqual([
      { authType: "api_key", label: "Log in" },
    ]);
  });

  it("a single api_key method already configured offers 'Re-login'", () => {
    expect(
      providerAuthLoginChoices(provider({ authTypes: ["api_key"], configured: true })),
    ).toEqual([{ authType: "api_key", label: "Re-login" }]);
  });

  it("a single oauth method uses oauthLoginLabel when the provider supplies one", () => {
    expect(
      providerAuthLoginChoices(provider({ authTypes: ["oauth"], oauthLoginLabel: "Sign in" })),
    ).toEqual([{ authType: "oauth", label: "Sign in" }]);
  });

  it("a single oauth method with no oauthLoginLabel falls back to Log in/Re-login", () => {
    expect(providerAuthLoginChoices(provider({ authTypes: ["oauth"] }))).toEqual([
      { authType: "oauth", label: "Log in" },
    ]);
  });

  it("both methods available offers a per-method choice, OAuth labeled with oauthLoginLabel", () => {
    expect(
      providerAuthLoginChoices(
        provider({ authTypes: ["api_key", "oauth"], oauthLoginLabel: "Sign in with ChatGPT" }),
      ),
    ).toEqual([
      { authType: "api_key", label: "API key" },
      { authType: "oauth", label: "Sign in with ChatGPT" },
    ]);
  });

  it("both methods available with no oauthLoginLabel falls back to a generic OAuth label", () => {
    expect(providerAuthLoginChoices(provider({ authTypes: ["api_key", "oauth"] }))).toEqual([
      { authType: "api_key", label: "API key" },
      { authType: "oauth", label: "Log in with OAuth" },
    ]);
  });
});
