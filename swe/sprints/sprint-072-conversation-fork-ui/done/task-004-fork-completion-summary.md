# Task 004 — Fork completion: composer prefill, cancellation, errors — Summary

- **Sprint:** sprint-072-conversation-fork-ui
- **Completed:** 2026-08-26
- **Status:** done

## What was implemented

`fork-result.ts` — two small, pure(ish) functions applying a settled `fork(entryId)` RPC, wired
into `ForkDialog.tsx`'s `handleConfirm` in place of the task-003 placeholder that always closed
regardless of outcome:

- **`applyForkSuccess(agentId, result)`**: if `result.cancelled`, toasts the § 12 "An extension
  declined the fork." copy and closes the dialog — nothing else changes (no timeline reset should
  arrive for a cancelled fork). Otherwise, closes the dialog, resolves the forked session via
  `session-store`'s `findByAgentId(agentId)` (never "whichever composer has focus"), and writes
  `result.text` into that session's draft via `draft-store`'s `setDraft` — but ONLY when that
  draft is currently empty; a non-empty draft is left completely untouched, silently (no toast).
- **`applyForkError(error)`**: toasts `error.message` when the caught value is an `Error` with a
  readable message (the daemon's own `RpcError` text), falling back to § 12's "Couldn't fork. Try
  again." otherwise, then calls `fork-store`'s `setPending(false)` — deliberately NOT `close()` —
  so the dialog returns to a reusable, non-pending confirm state instead of disappearing.

Both functions touch only `fork-store`/`draft-store`/`toast-store`; neither one reads nor writes
anything on `session-store`'s `timeline` field or calls `setTimeline`/`applyStreamEvent` — timeline
convergence remains exclusively task-001's `agent_timeline_reset` broadcast handler's job, per the
task's explicit "no bespoke path for the requester" design.

`ForkDialog.tsx`'s `handleConfirm` was simplified from a `try/catch/finally` that always called
`close()` to a `try { ...; applyForkSuccess(...) } catch (error) { applyForkError(error) }` — no
`finally`, since the two outcomes now decide close-vs-stay-open themselves.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/fork-result.ts` | created |
| `packages/web-client/src/features/chat/fork-result.test.ts` | created (8 tests) |
| `packages/web-client/src/features/chat/ForkDialog.tsx` | modified — `handleConfirm` now calls `applyForkSuccess`/`applyForkError` instead of unconditionally closing |
| `packages/web-client/AGENTS.md` | modified — conversation-fork invariant section extended for task-004 |
| `swe/features/conversation-fork.md` | modified — ticked 1 criterion, partially annotated another |

## How it satisfies the scope

Directly implements `swe/features/conversation-fork.md` § web-client "on fork completion" and
§ Error handling & edge cases, matching the task's own pseudocode line for line: cancelled → toast
+ close + done; otherwise → close, then conditional draft write; no timeline handling anywhere in
this file. Copy strings (`FORK_DECLINED_TOAST`, `FORK_GENERIC_ERROR_TOAST`) are reproduced verbatim
from § 12's copy deck — the "unsaved session"/"stale entry" rows in that same table are NOT
client-authored strings; they document what the daemon's own `rpc_error` message is expected to
read like, and are forwarded via `error.message` as-is, never reformatted or matched against.

Deviation: the cancelled/`rpc_error` branches could not be live-verified against a real daemon +
`pi` process — the mock provider's `fork()` unconditionally resolves `{cancelled: false}` and never
rejects, so there is no reachable live path to either branch in this environment. Covered
end-to-end by `fork-result.test.ts` instead, which is the codebase's established fallback for
logic a mock provider can't reach (task-002's fork-gate.test.ts, fork-correlation.test.ts follow
the identical precedent).

## Build & test results

```
$ npm run build
✓ all packages built

$ npx tsc -b --force
(no output — clean)

$ npm run lint
(warnings only, all pre-existing/unrelated — exit 0)

$ npx vitest run packages/web-client
Test Files  94 passed (94)
     Tests  1277 passed (1277)   # was 1269 before this task; +8 new (fork-result.test.ts)

$ npm test   (full monorepo)
Test Files  202 passed (202)
     Tests  2664 passed (2664)
```

Manual (browser, real dev daemon + mock provider, `/tmp/fork-t004`):
1. Sent a user message, forked it (picker fallback → select → confirm → "Fork from here") with an
   empty composer → composer showed `"mock forked text for mock-entry-0"` verbatim; dialog closed
   cleanly; no toast.
2. Typed a draft (`"my in-progress draft, do not clobber"`), forked the same row again → draft
   completely unchanged after the fork resolved; no warning toast; dialog closed.

## Acceptance criteria

- [x] Success with an empty draft prefills the composer with the returned text — live-verified +
      `fork-result.test.ts`.
- [x] Success with a non-empty draft leaves the draft untouched and shows no warning —
      live-verified + test.
- [x] Prefill targets the forked session's own draft even when another session's composer is
      focused — `fork-result.test.ts` (two hydrated sessions, second activated, prefill lands on
      the first regardless).
- [x] A cancelled fork toasts the § 12 string, closes the dialog, and changes nothing else —
      `fork-result.test.ts` only (no live-daemon path with the mock provider).
- [x] An `rpc_error` toasts the message and leaves the dialog in a reusable idle state —
      `fork-result.test.ts` only (same limitation).
- [x] This task contains no timeline refetch logic — verified by code review + grep (`fork-result.ts`
      never references `timeline`/`setTimeline`/`applyStreamEvent`).

## Follow-ups / TODO(verify)

- Live verification of the cancelled/`rpc_error` branches against a real `pi` process is deferred —
  no credentials available in this environment. The pure application logic is provider-agnostic
  and fully covered by unit tests regardless.
- Compact/keyboard layout (task-005) and the sprint close (task-006) remain.
