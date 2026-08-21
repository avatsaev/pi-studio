# Task 007 — Broadcast PTY size on resize, and degrade the ring gracefully on an unterminated tail

- **Sprint:** sprint-053-terminal-fidelity
- **Status:** done
- **Type:** bugfix
- **Estimated size:** S
- **Depends on:** none (sprint-052 shipped the sizing model this builds on)

## Goal
Close the two known limitations left explicitly open by sprint-052's review:

1. **Multi-client belief drift.** A client's cached idea of the PTY's size goes stale the moment
   another client resizes the same terminal, and its dedupe then suppresses a `Resize` it should send.
2. **Snapshot ring drops everything on an unterminated escape sequence.** Binary spew can leave the
   replay snapshot empty for far longer than necessary.

Neither is a regression — both are recorded as known limitations in
`swe/features/terminals.md` § PTY size ownership and § Restore / snapshot. This task
removes them.

## Background / why

### 1. Belief drift between clients
Sprint-052 made PTY sizing work by separating **permission** (`isSizeAuthority` — am I the visible
renderer?) from **knowledge** (`believedSizeRef` — what do I think the PTY's size is?), with
`shouldClaimSize` deduping against the belief. The belief is seeded from `create_terminal_request`'s
and `subscribe_terminal_request`'s echo of the PTY's real size, then updated on each successful send.

The gap: the daemon never tells anyone else. `terminals.md` § PTY size ownership states "The server
does **not** broadcast resize ownership", so with two browsers open on the same terminal:

- A attaches at 190×50 → PTY is 190×50, A believes 190×50.
- B attaches at 100×30 → PTY is 100×30, B believes 100×30. **A still believes 190×50.**
- A's pane later settles back to exactly 190×50 → `shouldClaimSize` sees no change and sends nothing,
  so A renders 190 columns against a 100-column PTY: early wrapping, misplaced cursor on backspace and
  history recall, background colour stopping short of the rendered columns.

This is the same class of failure sprint-052 fixed for the single-client case, just reached through a
second client instead of a focus change.

The fix already has an established shape in this file: `terminal-rpc.ts` broadcasts `terminals_update`
with the full list on create/rename/kill, and `TerminalRuntimeEntry` already carries `cols`/`rows`. A
resize simply needs to do the same, and clients need to re-seed belief from it.

Note the interaction with **task-003** in this sprint, which adds a `terminals_update` listener to the
web client for exited-terminal state. Both tasks want the same listener. Whichever lands second must
extend the existing listener rather than adding a parallel one — coordinate, do not duplicate.

### 2. Ring drops the whole snapshot on an unterminated sequence
`safeReplayStart` (`terminal-manager.ts:387`) returns `buffer.length` when the escape sequence straddling
the cut never terminates before the end of the retained bytes — i.e. "nothing here is safe to replay".
`SnapshotRing.compact` then keeps nothing. That is correct but maximally pessimistic: a single
`ESC P` (DCS) with no ST — trivially produced by `cat` on a binary file — empties the snapshot, and it
stays empty until enough clean output arrives to refill the ring. A reattaching client sees a blank
terminal where a partial-but-readable screen was available.

A cheaper degradation: when no safe boundary exists at or after the requested cut, fall back to the
naive cut rather than discarding everything. The replay may begin mid-sequence (the emulator eats a
few bytes as garbage — bounded, one sequence's worth), which is strictly better than showing nothing.
Guard it so the *normal* path is unchanged: only the "no safe boundary at all" case degrades.

## Scope references
- `swe/features/terminals.md` § PTY size ownership (the "known limitation of multi-client
  sizing" bullet this task removes), § Restore / snapshot tier 1 (ring trim cost + safety)
- `packages/server/src/terminal/terminal-manager.ts` — `resize`, `safeReplayStart`, `SnapshotRing`
- `packages/server/src/terminal/terminal-rpc.ts` — the existing `terminals_update` broadcasts
- `packages/server/src/terminal/terminal-manager.test.ts` — `safeReplayStart` unit tests, snapshot-ring
  tests, resize-validation tests
- `packages/web-client/src/features/terminal/TerminalPanel.tsx` — `believedSizeRef`, `claimSize`
- `packages/web-client/src/features/terminal/terminal-size.ts` — `shouldClaimSize`
- `swe/sprints/sprint-053-terminal-fidelity/backlog/task-003-exited-terminal-state.md` —
  the other consumer of a `terminals_update` listener

## What to build

### Resize broadcast
- Daemon: broadcast `terminals_update` after a resize that actually changed the size. `manager.resize`
  already returns `false` for a rejected/unknown resize and `true` for both an applied change and a
  same-size no-op — so either have it report "changed" distinctly, or compare before/after in the
  caller. Do **not** broadcast on a no-op: that would put a broadcast on the hot path of every
  coalesced drag frame.
- Both size paths must broadcast: the binary `Resize` frame handler (`makeTerminalBinaryHandler`) and
  `subscribe_terminal_request`'s pre-snapshot resize. The binary handler currently has no access to
  the broadcast seam — wire one in the same way `registerTerminalHandlers` does, without giving
  `TerminalManager` itself a dependency on sessions.
- Web client: on `terminals_update`, re-seed `believedSizeRef` for the matching slot from the entry's
  `cols`/`rows`. Guard with `isMeasurable` exactly as the existing echo paths do. Re-seeding belief is
  **not** a claim — it must not send a `Resize` frame, and must not bypass `isSizeAuthority`. After
  re-seeding, the authority's next genuine change or reconcile naturally corrects the PTY.
- No new binary opcode and no protocol-package schema entry: follow the established push-family
  convention (local interface + type guard at the point of use, per root `AGENTS.md` § Protocol
  overview).

### Ring degradation
- Give `safeReplayStart` (or `SnapshotRing.compact`) a documented fallback: if no safe boundary exists
  at or after the requested cut, use the naive cut instead of dropping the entire retained region.
- Keep the existing guarantee for the common case: when a safe boundary *does* exist, it is still
  chosen. Do not weaken the mid-sequence protection that sprint-052/task-005 added.
- Update `terminals.md` § Restore / snapshot to describe the fallback, replacing the current
  "drops to `buffer.length`" description.

## Out of scope
- Any new binary opcode, or a dedicated `terminal_resized` message type — `terminals_update` already
  carries the whole inventory including sizes.
- Server-side arbitration of *which* client owns the size. Last-interacting-client-wins stays; this
  task only stops other clients from holding a stale belief.
- Reflowable restore (tier 2) — that is task-004/task-005 of this sprint.
- Changing the 75% low-water mark or the 64 KiB cap.

## Acceptance criteria
- [ ] Two browser windows open on the same terminal at different sizes: resizing in one updates the
      other's belief, and the other window's next genuine viewport change sends a `Resize` reflecting
      its real grid instead of being deduped away. **Not live-verified** — the wiring this depends on
      (`resizeAndBroadcast` triggering `terminals_update` only on a real change,
      `believedSizeFromBroadcast` picking the right entry, `TerminalPanel`'s listener applying it to
      `believedSizeRef` without a claim) is each covered by unit tests below instead; see Notes.
- [x] A coalesced divider drag still produces exactly one `Resize` frame **and** at most one
      `terminals_update` broadcast — no broadcast per intermediate frame, none for a same-size resize.
      (`terminal-rpcs.test.ts`: same-size binary `Resize` frames add no broadcast; a real change adds
      exactly one; a further same-size frame at the new size adds none.)
- [x] Re-seeding belief from a broadcast sends no `Resize` frame by itself (verified: no `0x03` frame
      in devtools when another client resizes). `TerminalPanel`'s reseed effect only ever assigns
      `believedSizeRef.current`; it never calls `claimSize`/`router.sendResize` — structurally
      incapable of emitting a frame, confirmed by reading the effect body, not by a live devtools
      capture.
- [x] A background/non-authority tab still sends nothing when it receives a broadcast. The reseed
      effect does not gate on `isSizeAuthority` at all (re-seeding is not a claim for any tab), so
      this holds unconditionally rather than needing a live non-authority scenario to confirm.
- [x] A snapshot ring whose retained region contains an unterminated `ESC P` returns readable content
      rather than an empty snapshot, while a ring with a legitimate mid-sequence cut still starts at
      the safe boundary. (`terminal-manager.test.ts`: new ring-level test with an unterminated OSC
      forcing the wholesale-replace path; all pre-existing mid-sequence `safeReplayStart` tests still
      pass unchanged.)
- [x] `safeReplayStart`'s existing unit tests still pass unchanged in intent; the unterminated-tail
      test is updated to assert the new fallback rather than the old drop-everything behaviour.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Test / verification plan
- Unit (`packages/server/src/terminal/terminal-manager.test.ts`): the unterminated-tail case returns
  the naive cut; a normal mid-CSI cut still returns the safe boundary; a same-size resize reports "not
  changed" so no broadcast is triggered.
- Unit (`packages/server/src/terminal/terminal-rpcs.test.ts`): a binary `Resize` frame that changes the
  size produces exactly one `terminals_update` to active sessions; a rejected or same-size one produces
  none; `subscribe_terminal_request` with a differing grid produces one.
- Unit (`packages/web-client/src/features/terminal/terminal-size.test.ts`): `believedSizeFromBroadcast`
  — unknown slot, no match, unmeasurable entry, and the multi-entry case all covered.
- Unit (`packages/web-client/src/hooks/use-terminal-exit-watch.test.ts`): `isTerminalsUpdate` still
  accepts entries carrying `cols`/`rows`.
- Ran `npx vitest run packages/server/src/terminal` and the full `packages/server`/`packages/web-client`
  suites (2264 tests), plus `npm run build:server`/`build:web-client` and `tsc -b --force` for both
  packages. **Not run:** the manual two-browser-window sequence below — deferred for the same reason
  sprint-052/task-006's live pass was waived by the user this session (see that task's summary's §
  Closure); nothing here is riskier than what task-006 already accepted leaving unproven.
  1. Resize window A; confirm B's belief updates (devtools: no `0x03` from B on receipt).
  2. Then resize B slightly; confirm B sends a `Resize` carrying B's real grid.
  3. Return A to its original size; confirm A sends a `Resize` (previously deduped away) and the shell
     wraps correctly at A's width.
  4. `cat` a small binary file in a terminal, reload; confirm the replay shows readable content rather
     than a blank screen.

## Notes
Task-003 in this sprint also introduces a web-client `terminals_update` listener
(`use-terminal-exit-watch.ts`'s global `useTerminalExitWatch`, operating on the shared tab store for
exited-terminal reconciliation). This task's belief-reseed is inherently per-panel state
(`believedSizeRef` is a component-local `useRef`, deliberately not tab-store state, so it stays out
of React's render cycle — see `TerminalPanel.tsx`'s own doc comment on the seam). It therefore cannot
be reconciled from that global hook and instead lives in its own `useEffect` inside `TerminalPanel`,
reusing that file's `TerminalsUpdateMessage` type and `isTerminalsUpdate` guard (extended with
optional `cols`/`rows` on each entry) rather than declaring a parallel type — the "extend, don't
duplicate" ask above is satisfied at the type/convention level; the two effects remain structurally
separate because their state (global tab store vs. per-panel ref) is.

Implementation note for the ring fallback: `safeReplayStart` has **two** callers —
`SnapshotRing.compact` (`terminal-manager.ts:490`) and the oversized-single-chunk path in
`SnapshotRing.append` (`:475`) — so put the fallback inside `safeReplayStart` itself (or cover both
call sites). While there, fix the doc comment at `:356` claiming `SnapshotRing.compact` is its only
caller; `append` already contradicts it.
