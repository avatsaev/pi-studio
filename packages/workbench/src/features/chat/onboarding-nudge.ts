/**
 * `shouldShowProviderOnboardingNudge` — the pure decision behind the empty-timeline onboarding
 * nudge (sprint-065/task-006, `Timeline.tsx`). Pulled out of the component so the one subtle rule
 * — `configured: "unknown"` must suppress the nudge, not merely fail to trigger it — gets a real
 * unit test; this repo's Vitest runner has no jsdom, so `Timeline.tsx` itself is verified manually
 * in a real browser (see the task's own verification plan) and this module carries the logic that
 * can be tested headlessly.
 */

import type { ProviderAuthInfo } from "@av-pi-studio/protocol";

/**
 * The nudge shows only when the daemon has the capability, the provider list has loaded, and
 * every provider is a *confirmed* `false` — a bounded-out `checkAuth()` (`configured: "unknown"`)
 * is not evidence of "unconfigured" and must suppress the nudge exactly like a confirmed `true`
 * does, so a user whose credential actually works (just not confirmed within the probe's bound)
 * is never nagged.
 */
export function shouldShowProviderOnboardingNudge(
  providerAuthCapable: boolean,
  providers: ProviderAuthInfo[] | undefined,
): boolean {
  if (!providerAuthCapable || providers === undefined) return false;
  return providers.every((p) => p.configured === false);
}
