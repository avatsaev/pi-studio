import { describe, expect, it } from "vitest";
import type { ProviderAuthInfo } from "@av-pi-studio/protocol";
import { shouldShowProviderOnboardingNudge } from "./onboarding-nudge.js";

function provider(overrides: Partial<ProviderAuthInfo> = {}): ProviderAuthInfo {
  return {
    id: "anthropic",
    name: "Anthropic",
    authTypes: ["api_key"],
    configured: false,
    ...overrides,
  };
}

describe("shouldShowProviderOnboardingNudge", () => {
  it("shows the nudge when every provider is confirmed unconfigured", () => {
    expect(
      shouldShowProviderOnboardingNudge(true, [
        provider({ id: "anthropic", configured: false }),
        provider({ id: "openai", configured: false }),
      ]),
    ).toBe(true);
  });

  it("shows the nudge when the provider list is empty (capability on, nothing to configure)", () => {
    expect(shouldShowProviderOnboardingNudge(true, [])).toBe(true);
  });

  it("hides the nudge when at least one provider is configured", () => {
    expect(
      shouldShowProviderOnboardingNudge(true, [
        provider({ id: "anthropic", configured: true }),
        provider({ id: "openai", configured: false }),
      ]),
    ).toBe(false);
  });

  it('hides the nudge when a provider is "unknown", even with no confirmed-true provider — a bounded-out checkAuth is not evidence of unconfigured', () => {
    expect(
      shouldShowProviderOnboardingNudge(true, [
        provider({ id: "anthropic", configured: "unknown" }),
        provider({ id: "openai", configured: false }),
      ]),
    ).toBe(false);
  });

  it("hides the nudge when the capability is absent, regardless of provider data", () => {
    expect(shouldShowProviderOnboardingNudge(false, [provider({ configured: false })])).toBe(false);
  });

  it("hides the nudge while the provider list has not loaded yet", () => {
    expect(shouldShowProviderOnboardingNudge(true, undefined)).toBe(false);
  });
});
