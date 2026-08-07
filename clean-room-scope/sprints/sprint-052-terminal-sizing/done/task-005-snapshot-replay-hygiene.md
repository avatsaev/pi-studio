# Task 005 — Snapshot replay hygiene: reset before replay, and never cut the ring mid-escape

- **Sprint:** sprint-052-terminal-sizing
- **Status:** done
- **Type:** bugfix
- **Estimated size:** S
- **Depends on:** none

## Goal
Make the basic-tier snapshot replay safe: the client resets its emulator before replaying (instead of
clearing it), and the daemon's 64 KiB byte ring is never truncated in the middle of an escape
sequence.

## Background / why
`terminals.md` § Restore / snapshot, tier 1 now states both constraints. Neither holds today, and each
independently garbles a reattached terminal — a second, distinct cause of "text all scrambled up"
that survives task-002/003's size fix because it happens on reload/reconnect rather than on a fresh
open.

**Reset, not clear.** `TerminalPanel.tsx:215-218` does `terminal.clear()` then `write(snapshot)`.
`Terminal.clear()` empties the viewport and scrollback but keeps the *current line* and, crucially,
leaves the emulator's modes intact: alt-screen state, `DECSTBM` scroll margins, character-set
selection, wraparound and origin modes, and cursor visibility all carry over from whatever the
previous stream left behind. Replaying a snapshot into that state produces output confined to a stale
scroll region or drawn with the wrong character set. `reset()` is the correct primitive.

**Escape-safe truncation.** `terminal-manager.ts:297-300`:

```
appendBounded(buffer, data, max): concat, then keep the last `max` bytes
```

The cut is a raw byte offset. Once the ring exceeds 64 KiB — which happens within seconds of any
build or log output — the first bytes a resubscriber replays are whatever fell on that boundary,
frequently the middle of a CSI/OSC sequence. The emulator then consumes the following printable text
as sequence parameters and discards it, or applies a nonsense SGR/cursor op, and everything after the
cut is displaced. This is why a reattached long-running terminal looks corrupted at the top.

## Scope references
- `clean-room-scope/features/terminals.md` § Restore / snapshot (tier 1's two constraints and the
  reset requirement)
- `packages/server/src/terminal/terminal-manager.ts:184-198` (`subscribe` — sends the ring),
  `:258-267` (`onOutput` — appends), `:297-300` (`appendBounded`)
- `packages/server/src/terminal/terminal-manager.test.ts` (existing snapshot-then-live coverage to
  extend)
- `packages/web-client/src/features/terminal/TerminalPanel.tsx` (`onSnapshot` handler)
- `packages/protocol/src/binary-frames/terminal-stream-protocol.ts` (frame shapes; unchanged)

## What to build
- **Daemon:** replace the raw byte cut with an escape-aware trim. Export it as a pure function from
  `terminal/` so it is directly unit-testable, e.g.:
  ```ts
  /** Index of the first byte in `buffer` at or after `from` that can safely start a replay —
   *  i.e. not inside an incomplete escape/CSI/OSC/DCS sequence. */
  export function safeReplayStart(buffer: Uint8Array, from: number): number;
  ```
  It scans forward from the naive cut to the end of any sequence straddling it: `ESC` (`0x1b`)
  followed by CSI (`[` … final byte `0x40`–`0x7e`), OSC (`]` … `BEL` or `ESC \`), DCS/SOS/PM/APC
  (… `ESC \`), and two-byte `ESC <single char>` forms. It must also not split a multi-byte UTF-8
  sequence. Bounded: if no terminator is found within the retained window, drop to the end rather
  than scanning forever.
  `appendBounded` uses it, so the ring always begins at a replay-safe boundary. Prefer dropping a few
  extra bytes over emitting a partial sequence.
- **Client:** `onSnapshot` → `terminal.reset()` then `write(chunk)`. (`onRestore` gets the same
  treatment in sprint-053 when tier 2 lands; keep the two handlers' replay logic in one small local
  helper now so they cannot diverge.)

## Out of scope
- The reflowable (tier 2) `Restore` payload — sprint-053. This task makes the *basic* tier correct;
  it does not make it width-correct, which is inherent to raw-byte replay and is precisely what tier 2
  exists to solve.
- Changing the 64 KiB default or making it configurable.
- The 4 ms output coalescing.

## Acceptance criteria
- [ ] `safeReplayStart` is unit-tested: cut inside a CSI sequence, inside an OSC terminated by `BEL`,
      inside an OSC terminated by `ESC \`, inside a two-byte `ESC` form, inside a multi-byte UTF-8
      character, at a byte that is already safe (returns `from` unchanged), and with no terminator in
      the window (drops to the end).
- [ ] A terminal that has emitted far more than 64 KiB, then is resubscribed, replays starting at a
      safe boundary: the snapshot renders as coherent text with no displaced/garbled leading region.
- [ ] The existing `terminal-manager.test.ts` snapshot-then-live-output expectations still pass.
- [ ] `onSnapshot` calls `reset()`, not `clear()`; grep confirms no `clear()` remains on the replay
      path.
- [ ] A terminal left inside a full-screen app (e.g. `less`, then `q`; or `vim`, then `:q`) and then
      reattached renders normally rather than into a stale scroll region.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Test / verification plan
- Unit: extend `packages/server/src/terminal/terminal-manager.test.ts` (or a sibling
  `screen-ring.test.ts` if the helper lands in its own module) with the `safeReplayStart` cases above
  plus a `appendBounded` case asserting the retained buffer starts safely. Run
  `npx vitest run packages/server/src/terminal`.
- Build/typecheck/lint/tests: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
- Manual, against `npm start`:
  1. In a terminal, run something that emits ≫64 KiB with heavy escapes (`npm run build`, or
     `for i in $(seq 2000); do printf '\033[32mline %s\033[0m\n' $i; done`).
  2. Reload the browser → the restored terminal's replayed screen is coherent from its first line.
  3. Run `less` on a large file, quit, reload → no stale scroll region, prompt renders normally.
  4. `pi-studio terminal capture <slot>` still returns sensible screen text (the headless grid path is
     untouched by this change — confirm it did not regress).

## Notes
The `ScreenBuffer` (`@xterm/headless`) path used by `capture` is unaffected: it consumes the full byte
stream as it arrives and never replays the ring. Do not "fix" it in the same pass.
