# Task 006 — Onboarding nudge in the empty chat timeline

- **Sprint:** sprint-065-provider-auth-ui
- **Status:** done
- **Type:** feature
- **Area:** web-client / features/chat
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-003

## Goal
When a connected daemon has no configured model provider, the empty chat state says so and offers a
one-click path to fix it, instead of letting the user discover the problem by sending a prompt that
fails.

## Context / why
This is the actual first-run experience the whole feature exists for: a fresh daemon has no
credential, and today the only signal is a failed turn. The nudge closes the loop between "nothing
works" and "here is where you fix it".

Placement was an open question resolved during planning: `features/chat/Timeline.tsx` already renders
`No messages yet — say something to start.` when its row list is empty, and there is **no app-wide
banner pattern** in this codebase to reuse — so the empty state is the slot, built on the existing
`EmptyState` primitive rather than inventing a banner.

## Scope references
- `swe/features/provider-auth-ui.md` § Web UI surface (onboarding nudge), and the resolved TODO on
  nudge placement
- `packages/web-client/src/features/chat/Timeline.tsx` (the empty-state branch)
- `packages/web-client/src/components/primitives/EmptyState.tsx`
- `packages/web-client/src/features/provider-auth/ModelProvidersPanel.tsx` inside
  `features/settings/SettingsDialog.tsx` (task-003 — what the CTA opens)
- `packages/web-client/src/lib/connection/rpc-keys.ts` (share the provider-list query key so the nudge
  and the settings panel never disagree)

## What to build
- In the empty-timeline branch, when **all** of: connected, `hasProviderAuthCapability()` is true, and
  `listProviderAuth()` reports zero providers with `configured === true` — render an `EmptyState`-based
  call-to-action ("Connect a model provider") whose action opens the task-003 settings dialog on the
  Model Providers category.
- Reuse the same query key as the settings panel, so a successful login invalidates one cache and
  both surfaces update together, with no reload and no second fetch path.
- `configured: "unknown"` does **not** count as unconfigured — a bounded-out `checkAuth` must not
  nag a user whose credential actually works.
- When the capability is absent, or any provider is configured, the empty state is exactly what it is
  today — byte-identical copy, no layout shift.

## Out of scope
- Any other placement (composer banner, connection bar, status bar) — one surface only.
- Blocking or gating the composer when no provider is configured; the nudge is advisory.

## Acceptance criteria
- [ ] Against a daemon with zero configured providers, opening a new/empty chat shows the CTA; clicking
      it opens the settings dialog on the Model Providers category.
- [ ] Completing a login makes the CTA disappear without a page reload (shared query invalidation).
- [ ] With at least one configured provider, the empty state is unchanged from today's text.
- [ ] With a capability-less daemon, no CTA and no provider-auth RPC is issued from this path.
- [ ] A provider reporting `configured: "unknown"` suppresses the nudge (it is not evidence of
      "unconfigured").
- [ ] A non-empty timeline never renders the CTA.
- [ ] All CSS values come from design tokens; no raw px/hex literals.

## Test / verification plan
- Manual (real browser, production-bootstrap daemon): with an empty `auth.json`, open a fresh session
  → CTA appears → log in via the settings dialog → CTA disappears while the session stays open; then reload and
  confirm it stays gone. Repeat against a daemon build without the capability flag.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Notes
Keep the fetch shared, not duplicated: two independent `listProviderAuth()` call sites would show a
stale CTA beside a freshly-configured provider — the exact inconsistency this task must not introduce.
