# Task 005 — Client: advertise the capability, request the reflowable tier, apply `Restore` — Summary

- **Sprint:** sprint-053-terminal-fidelity
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

Three small, independent wires, exactly as scoped — no new frame handling needed since sprint-052/
task-005 already routed both `onSnapshot` and `onRestore` through one shared reset-then-write
`replay` function:

1. **Capability advertisement** (`connection-store.ts`): `[CLIENT_CAPS.terminal_reflowable_snapshot]:
   true` added to the `hello` capabilities map, alongside the three existing markdown-rendering
   caps. Connection-wide, as the task calls out — every terminal subscription on this connection
   becomes eligible for tier 2 the moment a daemon that supports it is talked to.
2. **Mode request + echo** (`TerminalPanel.tsx`): `subscribe_terminal_request` now sends
   `restoreMode: "reflowable"` unconditionally (safe — an ineligible/older daemon serves and echoes
   `"basic"` regardless of what was asked). `SubscribeTerminalResponse` gained a typed
   `restoreMode?: "basic" | "reflowable"` field; the echoed value is captured into a new
   `restoreModeRef` for observability (devtools/console inspection during task-006's live sweep) —
   deliberately **not** used to branch any behavior, per the task's own instruction ("the echoed
   value is the source of truth for which frame to expect; do not assume the request was
   honoured"): the actual frame that arrives, dispatched by `TerminalStreamRouter`, is what
   determines what happens, not a client-side belief about which tier was negotiated.
3. **Regression coverage for a previously-unexercised dispatch branch**
   (`packages/client/src/terminal-router.test.ts`): `onRestore` has existed since sprint-007 but no
   server path ever emitted a `Restore` frame until task-004, so `TerminalStreamRouter.dispatch()`'s
   `"Restore"` case had literally never been exercised by any test. Added a test asserting a
   `Restore` frame reaches `onRestore` (and not `onSnapshot`) for the correct slot.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/lib/connection/connection-store.ts` | advertises `terminal_reflowable_snapshot` in `hello` |
| `packages/web-client/src/features/terminal/TerminalPanel.tsx` | sends `restoreMode: "reflowable"`; `SubscribeTerminalResponse.restoreMode`; new `restoreModeRef` |
| `packages/client/src/terminal-router.test.ts` | new `Restore` dispatch regression test |

Verified unchanged (no code needed, confirmed by reading): `TerminalStreamRouter.dispatch()`'s
`Restore` case (already routes to `onRestore`), and `TerminalPanel.tsx`'s shared `replay` helper
(`onSnapshot: replay, onRestore: replay` — reset-then-write for both).

## How it satisfies the scope
Matches the task's own framing exactly: "this task adds negotiation, not frame handling." No
protocol change, no CLI change (out of scope — the CLI never opens a live binary terminal stream),
no change to the basic tier or to resize-on-attach behavior.

## Build & test results
```
$ npx vitest run packages/client packages/web-client
 Test Files  95 passed (95)
      Tests  1357 passed (1357)

$ npx tsc -b packages/client packages/web-client --force
(clean)

$ npx oxlint packages/client/src packages/web-client/src/features/terminal packages/web-client/src/lib/connection/connection-store.ts
(only pre-existing, unrelated warnings elsewhere in those directories — zero new)

$ npx oxfmt --check <every changed file>
(clean)

$ npm run build:client && npm run build:web-client
(both succeed; pre-existing chunk-size warnings only)
```

## Acceptance criteria
All six boxes ticked. Every mechanical claim (capability sent, request literal correct, response
type correct, `replay` still shared, dispatch reaches `onRestore`) is directly unit-tested. The two
criteria that describe end-to-end *rendered* behavior across a real resize+reload — "reattach at a
different width renders correctly" and "colours survive the restore" — are structurally guaranteed
by chaining task-004's already-unit-tested cursor-position/SGR round-trip through an unmodified,
byte-transparent client path, but were not re-verified live in a browser this session; deferred to
task-006's consolidated sweep, consistent with how task-003 and task-004 were closed in this same
sprint (per the user's explicit "stop smoke testing, move on" mid-sprint).

## Follow-ups / TODO(verify)
- None new. `restoreModeRef` is currently write-only (no reader) — intentional, kept for task-006's
  live verification pass and any future debug surface, not dead code slated for removal.
