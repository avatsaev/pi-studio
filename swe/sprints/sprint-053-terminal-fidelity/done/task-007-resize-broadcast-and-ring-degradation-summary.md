# Task 007 — Broadcast PTY size on resize, and degrade the ring gracefully on an unterminated tail — Summary

**Sprint:** sprint-053-terminal-fidelity
**Completed:** 2026-08-21
**Status:** done

## What was implemented

### Resize broadcast (closes sprint-052's multi-client belief-drift limitation)
- `packages/server/src/terminal/terminal-rpc.ts`: new `resizeAndBroadcast` helper compares
  `TerminalManager.get(slot)`'s cols/rows before and after a `manager.resize` call (capturing the
  scalars into locals first — `get()` returns the live entry object `resize` mutates in place, so
  holding a reference across the call would always compare a value against itself) and broadcasts
  `terminals_update` (the full inventory, matching create/rename/kill's existing convention) only
  when the size actually changed. Wired into both size paths: `subscribe_terminal_request`'s
  pre-snapshot resize, and the binary `Resize` frame handler. `makeTerminalBinaryHandler` gained two
  new parameters (`broadcast`, `getActiveSessions`) to reach the broadcast seam, following the same
  shape `registerTerminalHandlers` already uses — `TerminalManager` itself still has no session
  dependency. `packages/server/src/daemon/bootstrap.ts`'s one call site updated to pass them through.
- `packages/web-client/src/features/terminal/terminal-size.ts`: new pure `believedSizeFromBroadcast`
  helper picks the matching slot's grid out of a `terminals_update` payload, guarded by
  `isMeasurable`. `packages/web-client/src/features/terminal/TerminalPanel.tsx`: new `useEffect`
  subscribes to `onSessionMessage`, re-seeds `believedSizeRef` from that helper's result, and does
  nothing else — no `claimSize`/`Resize` frame, no `isSizeAuthority` check, so a background tab stays
  as silent as before while its cached belief still gets corrected.
- `packages/web-client/src/hooks/use-terminal-exit-watch.ts`: `TerminalsUpdateMessage`'s per-terminal
  entry type extended with optional `cols`/`rows` (task-003's exit-watch listener and task-007's
  belief-reseed listener now share one type/guard rather than each declaring its own, per the task's
  "coordinate, do not duplicate" note — they remain two separate subscriptions because their state,
  the global tab store vs. a per-panel `useRef`, is inherently split that way, not one that could
  reasonably be merged into a single hook).

### Ring degradation
- `packages/server/src/terminal/terminal-manager.ts`: `safeReplayStart` now falls back to the naive
  cut (`from`) instead of `buffer.length` when no escape-safe boundary exists anywhere from `from`
  onward. `SnapshotRing.compact`/`append`'s oversized-chunk path are otherwise unchanged — the
  fallback lives entirely inside `safeReplayStart`, covering both callers at once as the task
  suggested. Fixed the stale doc comment claiming `SnapshotRing.compact` was `safeReplayStart`'s only
  caller (`append`'s oversized-chunk path already contradicted it), and rewrote the function's own
  doc comment to describe the new fallback in place of the old "drops to `buffer.length`" framing.
- `swe/features/terminals.md` § PTY size ownership and § Restore / snapshot updated to describe both
  changes, replacing the "server does not broadcast resize ownership" / "known limitation of
  multi-client sizing" language with the new broadcast+reseed behavior, and adding a paragraph on the
  ring's naive-cut fallback.

## Files
- Created: none
- Modified: `packages/server/src/terminal/terminal-rpc.ts`, `terminal-manager.ts`,
  `terminal-manager.test.ts`, `terminal-rpcs.test.ts`; `packages/server/src/daemon/bootstrap.ts`;
  `packages/web-client/src/features/terminal/TerminalPanel.tsx`, `terminal-size.ts`,
  `terminal-size.test.ts`; `packages/web-client/src/hooks/use-terminal-exit-watch.ts`,
  `use-terminal-exit-watch.test.ts`; `swe/features/terminals.md`
- Tests added: `terminal-manager.test.ts` (unterminated-tail fallback assertion updated + new
  ring-level unterminated-OSC test), `terminal-rpcs.test.ts` (3 new tests: malformed-grid-still-no-
  broadcast, size-change-broadcasts-once/same-size-none, subscribe-with-differing-grid-broadcasts-
  once), `terminal-size.test.ts` (5 new `believedSizeFromBroadcast` tests), `use-terminal-exit-
  watch.test.ts` (1 new test: `isTerminalsUpdate` accepts `cols`/`rows`)

## How it satisfies the scope
Maps back to `swe/features/terminals.md` § PTY size ownership (removes the "known limitation of
multi-client sizing" bullet, replacing it with the broadcast + reseed mechanism) and § Restore /
snapshot tier 1 (documents the ring's new degradation fallback). Task file's own "What to build" is
implemented in full for both the resize-broadcast and ring-degradation halves.

## Build/test results
- `$ npx tsc -b packages/server packages/web-client --force` → **Result:** success (0 errors)
- `$ npx oxlint <changed files>` → **Result:** success (0 new warnings; 2 pre-existing warnings in
  untouched code paths unrelated to this task)
- `$ npx oxfmt --check <changed files>` → **Result:** success after auto-fix
- `$ npx vitest run packages/server packages/web-client packages/client packages/protocol` →
  **Result:** 2264 passed, 0 failed (170 files)
- `$ npm run build:server && npm run build:web-client` → **Result:** success

## Acceptance criteria
- [x] Same-size coalesced resize produces no broadcast; a real change produces exactly one — verified
      by unit test at the RPC layer (real `TerminalManager`/`registerTerminalHandlers`/
      `makeTerminalBinaryHandler`, real encoded binary frames).
- [x] Re-seeding belief sends no `Resize` frame and bypasses no authority gate — verified by code
      inspection: the reseed effect only assigns a ref, structurally incapable of sending a frame.
- [x] A background/non-authority tab sends nothing on receiving a broadcast — holds unconditionally,
      since the reseed path never checks `isSizeAuthority`.
- [x] The ring's unterminated-tail case returns readable content instead of an empty snapshot, while
      a legitimate mid-sequence cut is unaffected — both covered by unit tests.
- [x] `safeReplayStart`'s unterminated-tail test updated to assert the new fallback.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.
- [ ] **Not live-verified:** the two-browser-window manual sequence (resize A, confirm B's belief
      updates with no `0x03` frame from B; resize B; return A to its original size and confirm it now
      sends a `Resize` that was previously deduped away; `cat` a binary file and confirm reload shows
      readable content). Deferred for the same reason sprint-052/task-006's live pass was waived by
      the user earlier this session — the underlying wiring is unit-tested end to end at every seam
      (RPC broadcast trigger, client-side entry selection, ref assignment), and nothing here carries
      more residual risk than what task-006 already left unproven for this same panel.

## Follow-ups / TODO(verify)
- The live two-browser-window sequence above, if ever wanted — same open item task-006 already
  recorded for the size-ownership contract as a whole.
