# Task 004 — Fork completion: composer prefill, cancellation, errors

- **Sprint:** sprint-072-conversation-fork-ui
- **Status:** done
- **Type:** feature
- **Area:** web-client/features/chat, web-client/stores
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003

## Goal

Handle every way a fork can resolve: success (close + prefill the composer), extension cancellation
(toast, nothing changes), and RPC failure (toast, dialog reusable).

## Context / why

The RPC response does **only two things**: close the dialog and prefill the composer. The timeline
refresh deliberately rides task-001's broadcast handler — the requester gets **no bespoke path**, so
the initiating tab, a second browser window, and a relay-connected phone all converge identically.
Special-casing the requester here would create exactly the divergence the broadcast design exists to
prevent.

Composer prefill happens **only when the draft is empty** — a user's in-progress draft is never
clobbered, and the skip is silent (no warning toast).

## Scope references

- `swe/features/conversation-fork.md` § web-client: on fork completion, § Error handling & edge cases
- `swe/UI design/fork-rewind-ui-specs/Fork Conversation Visual Spec - Dialog.dc.html` § 06 (states)
- `swe/UI design/fork-rewind-ui-specs/Fork Conversation Visual Spec - Copy and Edge Cases.dc.html`
  § 12, § 13
- `packages/web-client/src/stores/draft-store.ts` — `replaceDraft`, per-session drafts
- `packages/web-client/src/stores/toast-store.ts` — `show`/`error`
- `packages/web-client/src/features/chat/Composer.tsx` — composer draft consumption

## What to build

```
onForkResult(payload):
    if payload.cancelled: toast "An extension declined the fork"; close dialog; done
    close dialog
    if this session's composer draft is empty: draft = payload.text   # never clobber
    # NO timeline handling here — task-001's broadcast handler owns it
```

- **Cancelled** (`{cancelled: true}` from a `session_before_fork` extension handler): toast the § 12
  copy, close the dialog, change nothing else — no reset arrives, and none should be expected.
- **Success:** close the dialog; write `payload.text` into **that session's** draft (resolved by
  `agentId`, never "whichever composer has focus" — the `agent-ui-store.ts` precedent for
  `replace_composer_text`) only when that draft is empty.
- **Failure** (`rpc_error` — e.g. Pi's unsaved-session error *"This session has not been saved yet…"*,
  or an unknown/stale `entryId`): toast the daemon's message, return the dialog to **idle** (not
  closed) so a retry is possible without reopening.

## Out of scope

- Timeline refetch/convergence (task-001 — must not be duplicated here).
- Compact/keyboard (task-005).

## Acceptance criteria

- [x] Success with an **empty** draft prefills the composer with the returned text. Verified live
      (mock provider) and by `fork-result.test.ts`.
- [x] Success with a **non-empty** draft leaves the draft untouched and shows no warning. Verified
      live and by test.
- [x] Prefill targets the forked session's own draft even when another session's composer is
      focused — verified by `fork-result.test.ts` (two hydrated sessions, second activated,
      prefill still lands on the first).
- [x] A cancelled fork toasts the § 12 string, closes the dialog, and changes nothing else —
      verified by `fork-result.test.ts` (the mock provider always resolves `cancelled: false`, so
      this branch is unit-tested only; no live daemon path exercises it today).
- [x] An `rpc_error` toasts the message and leaves the dialog in a reusable idle state — verified
      by `fork-result.test.ts` (same live-daemon limitation as above: the mock provider's `fork()`
      never rejects).
- [x] This task contains **no** timeline refetch logic — `fork-result.ts` touches only
      `fork-store`/`draft-store`/`toast-store`; grepped for `timeline`/`setTimeline` to confirm
      zero references outside doc comments.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Tests: store-level cases for each acceptance criterion (empty vs non-empty draft, cross-session
  prefill targeting, cancelled, rpc_error → idle). Run `npx vitest run packages/web-client`.
- Manual (browser, real `pi`): fork with an empty composer → text appears; type a draft, fork again →
  draft preserved; fork an unsaved session (before any assistant reply) → Pi's error toasts and the
  dialog stays usable.
- Lint/format: `npm run lint`; `npx oxfmt <changed files>`.

## Notes

The § 13 edge-case matrix is the authority for these branches; keep the toast copy verbatim from
§ 12 rather than paraphrasing. Concurrent fork from two clients is expected to fail the second with
Pi's *"Invalid entry ID for forking"* — that lands in the generic `rpc_error` branch, no special
handling needed.

Verification against a real `pi` process (rather than the mock provider) for the cancelled/error
branches specifically — no credentials available in this environment; not attempted. The pure
application logic (`applyForkSuccess`/`applyForkError`) is provider-agnostic and fully exercised
by `fork-result.test.ts` regardless of which provider produced the resolved/rejected result.
