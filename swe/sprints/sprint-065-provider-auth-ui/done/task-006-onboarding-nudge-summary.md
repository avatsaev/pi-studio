# Task 006 — Onboarding nudge in the empty chat timeline — Summary

- **Sprint:** sprint-065-provider-auth-ui
- **Completed:** 2026-08-20
- **Status:** done

## What was implemented

The empty-timeline slot (`Timeline.tsx`) now doubles as the onboarding CTA: when the daemon
advertises `providerAuth` and every known provider is a *confirmed* `configured: false`, the plain
"No messages yet — say something to start." text is replaced by an `EmptyState`-based card ("No
messages yet — connect a model provider to get started." + a "Connect a model provider" button)
that opens the Settings dialog on Model Providers (the dialog's only category today, so no
category-selection API was needed).

The decision logic (`shouldShowProviderOnboardingNudge`) is a pure function in a new
`onboarding-nudge.ts` module, not inline in the `.tsx` — this repo's Vitest runner has no jsdom, so
component behavior is verified manually in a real browser and pure decision logic is what can carry
an automated regression test.

Two pre-existing gaps surfaced and were fixed as part of making this task correct and verifiable:

1. **`ConnectionBar`'s settings-dialog mount latch was click-handler-local.** `settingsEverOpened`
   was only ever set to `true` inside the gear button's own `onClick`, so `openSettings()` called
   from anywhere else (the new nudge) would flip the shared `ui-store` flag but never actually mount
   `<SettingsDialog>` the first time in a session. Fixed by deriving the latch from an effect on the
   shared `settingsOpen` field instead, so any caller of `openSettings()` triggers the first-mount
   import.
2. **The `configured: "unknown"` suppression rule was initially implemented backwards.** The first
   pass used `!providers.some(p => p.configured === true)`, which fires the nudge whenever nothing
   is confirmed configured — including when a provider is `"unknown"` (a bounded-out `checkAuth()`
   probe, e.g. an AWS-profile/ADC-file check that can hang). The spec is explicit that `"unknown"`
   is not evidence of "unconfigured" and must suppress the nudge exactly like a confirmed `true`
   does. Caught during acceptance-criteria review before this task was verified, not after; fixed to
   `providers.every(p => p.configured === false)` and locked down with a dedicated unit test.

`ModelProvidersPanel.tsx` was refactored to consume the same new `use-provider-auth-list.ts` hook
(rather than its own inline `useQuery`) — both surfaces now share one hook, not just one query key
string, closing off any risk of the two call sites drifting apart.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/onboarding-nudge.ts` | created — pure `shouldShowProviderOnboardingNudge` |
| `packages/web-client/src/features/chat/onboarding-nudge.test.ts` | created — 6 unit tests, including the `"unknown"`-suppresses case |
| `packages/web-client/src/hooks/use-provider-auth-list.ts` | created — shared `listProviderAuth()` query hook |
| `packages/web-client/src/features/chat/Timeline.tsx` | modified — onboarding-nudge branch in the empty-timeline render, capability/query wiring |
| `packages/web-client/src/features/chat/Timeline.module.css` | modified — `.nudge` class (design tokens only) |
| `packages/web-client/src/features/provider-auth/ModelProvidersPanel.tsx` | modified — now uses `useProviderAuthList()` |
| `packages/web-client/src/features/connection/ConnectionBar.tsx` | modified — settings-mount latch now derives from `settingsOpen`, not the click handler |
| `packages/web-client/AGENTS.md` | modified — `hooks/`, `features/chat/` layout entries, new "SettingsDialog mounts on settingsOpen" invariant |

## How it satisfies the scope

Matches `features/provider-auth-ui.md` § Web UI surface's onboarding-nudge resolution: the
`Timeline.tsx` empty-state branch is the slot (no new banner primitive), gated on the
`EmptyState`-based CTA, opening the existing settings-dialog affordance from task-003. The shared
query key requirement (`rpc-keys.ts`'s `providerAuthList()`) is satisfied more strongly than asked —
both surfaces share the hook itself, not just the key string.

## Build & test results

```
$ npm run build:web-client
✓ built in 10.29s

$ npx oxlint <touched files>
(no new warnings — 2 pre-existing warnings in untouched Attachments.tsx only)

$ npx oxfmt --check <touched files>
All matched files use the correct format.

$ npx vitest run packages/web-client
Test Files  69 passed (69)
     Tests  970 passed (970)

$ npx vitest run packages/web-client/src/features/chat/onboarding-nudge.test.ts
Test Files  1 passed (1)
     Tests  6 passed (6)
```

Live verification (real browser, four real daemon processes — a production-bootstrap daemon with
zero configured providers, one with a pre-seeded `anthropic` `auth.json` entry, the shipped dev
daemon, and a minimal throwaway harness built from the compiled `ws-server`/`http-server` modules
with an explicit `providerAuth: false` feature override — see the note below on why the shipped dev
daemon could not stand in for a genuinely capability-less one):

1. Zero-provider daemon, empty chat → CTA rendered with the exact copy from the task spec;
   screenshot captured.
2. Clicked the CTA → Settings dialog opened on Model Providers (the only category), showing every
   provider as "Not configured".
3. Configured-provider daemon (`anthropic` present in `auth.json`), empty chat → byte-identical
   original text, no CTA, no layout shift.
4. Logged the configured provider out through the Settings panel, closed the dialog → the CTA
   appeared in the same page load, no reload, no second fetch path — proving the shared-cache
   invalidation the task requires (exercised via `handleLogout`'s existing
   `invalidateQueries({queryKey: rpcKeys.providerAuthList()})`, the identical call a successful
   login also makes).
5. Capability-less daemon (`providerAuth: false`) → no Settings gear, plain original empty-state
   text, and a CDP WS-frame capture across the whole session showed **zero** `provider_auth_*`
   frames sent.
6. Non-empty timeline never renders the CTA — structurally guaranteed (unchanged
   `rows.length === 0` gate around the whole branch), confirmed by inspection.
7. New CSS (`.nudge`) uses only `var(--pi-font-size-sm)` and `100%`/`column` — no raw px/hex.

## Acceptance criteria

- [x] Against a daemon with zero configured providers, opening a new/empty chat shows the CTA;
      clicking it opens the settings dialog on the Model Providers category. (live, step 1–2 above)
- [x] Completing a login makes the CTA disappear without a page reload (shared query invalidation).
      Verified via the symmetric logout path, which shares the exact invalidation call a login makes
      (see Follow-ups for why login itself wasn't run against a real provider).
- [x] With at least one configured provider, the empty state is unchanged from today's text. (live,
      step 3 above — screenshot confirms byte-identical copy)
- [x] With a capability-less daemon, no CTA and no provider-auth RPC is issued from this path.
      (live, step 5 above, WS-frame capture)
- [x] A provider reporting `configured: "unknown"` suppresses the nudge. Verified by unit test
      (`onboarding-nudge.test.ts`), not live — reproducing a genuine bounded-probe timeout live is
      inherently flaky/slow; the pure decision function is exactly what the project's own testing
      convention says should carry this kind of branch coverage.
- [x] A non-empty timeline never renders the CTA. (structural — unchanged gate, confirmed by code
      inspection)
- [x] All CSS values come from design tokens; no raw px/hex literals. (confirmed by inspection)

## Follow-ups / TODO(verify)

- **Login was not run against a real provider credential.** The "configured" daemon's `auth.json`
  was pre-seeded directly (matching the documented `{"anthropic":{"type":"api_key","key":"..."}}`
  shape from `node_modules/@earendil-works/pi-coding-agent/docs/providers.md`) rather than driven
  through a real OAuth/API-key flow, since no real provider credential was available in this
  environment. The cache-invalidation mechanism itself was proven via the symmetric logout
  operation, which shares the identical `invalidateQueries` call. Task-007's live E2E run (step 2 in
  its own plan) exercises a real login end-to-end and is the right place to close this out fully.
- **Pre-existing defect found, not fixed (out of scope for this task):** `dev-bootstrap.ts` never
  passes a `features` override to `createWebSocketServer`, so the dev daemon advertises every
  `SERVER_FEATURES` flag as `true` — including `providerAuth` — despite never registering the
  `provider_auth_*` handlers. This means `ConnectionBar`'s Settings gear (already shipped in
  task-003, unrelated to this task) renders on the dev daemon today and would issue an RPC with no
  registered handler if clicked. This task's own capability gate is correct (verified against a
  true capability-less harness); the dev daemon's false advertisement is a separate, pre-existing
  bug worth a follow-up task if the dev daemon is ever meant to model a capability-less client
  accurately.
