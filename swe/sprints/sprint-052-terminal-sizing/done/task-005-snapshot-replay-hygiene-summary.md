# Task 005 — Snapshot replay hygiene: reset before replay, and never cut the ring mid-escape — Summary

- **Sprint:** sprint-052-terminal-sizing
- **Completed:** 2026-08-06
- **Status:** done

## What was implemented
- **Daemon — `safeReplayStart(buffer, from)`** (`terminal-manager.ts`, exported pure function): a
  single-pass state-machine scan of `buffer` from index 0 that classifies every byte as `normal`,
  mid-`ESC` (undecided), mid-`CSI` (awaiting a `0x40`–`0x7e` final byte), mid-`OSC` (awaiting `BEL`
  or `ESC \`), or mid-`DCS`/`SOS`/`PM`/`APC` (all string-typed, also `ESC \`-terminated). It parses
  from the *start* of `buffer`, not from `from`, because whether `from` lands inside a sequence
  depends on where that sequence began, which is frequently before `from` — exactly the case a raw
  byte-offset cut produces. The first index at or after `from` where the state is back to `normal`
  *and* the byte there is not a UTF-8 continuation byte (`0x80`–`0xBF`) is the safe start; a
  sequence/character straddling `from` is skipped past its terminator (or, if none appears before
  `buffer.length`, the function drops to `buffer.length` — nothing in an unterminated tail is safe).
- **`appendBounded`** now computes the naive cut (`combined.length - max`) and calls
  `safeReplayStart(combined, naiveCut)` before slicing, instead of slicing at the raw offset
  directly. This is the only caller-visible change to the ring's behavior; `onOutput` and the rest
  of `TerminalManager` are untouched.
- **Client — `TerminalPanel.tsx`**: `onSnapshot` and `onRestore` both now call a single local
  `replay(chunk)` helper (`terminal.reset()` then `write(chunk)`) instead of `onSnapshot` calling
  `terminal.clear()`. `reset()` also clears alt-screen/`DECSTBM`/charset/wraparound/origin-mode/
  cursor-visibility state that `clear()` leaves stale, which was the second, independent source of
  garbled reattach (a snapshot replayed into leftover modes renders into the wrong scroll region or
  with the wrong charset). `onRestore` never fires yet (tier 2 lands in sprint-053) but shares the
  same helper now so a future tier-2 wire-up cannot forget the reset.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/terminal/terminal-manager.ts` | modified — added `safeReplayStart` (exported) + 4 small classifier helpers (`isCsiFinalByte`, `isUtf8ContinuationByte`, `startsStringSequence`, `ReplayScanState`); `appendBounded` now trims through it |
| `packages/server/src/terminal/terminal-manager.test.ts` | modified — 9 `safeReplayStart` unit tests (CSI, OSC×BEL, OSC×ST, DCS×ST, two-byte ESC form, split UTF-8, already-safe, out-of-range clamping, unterminated-tail) + 1 `TerminalManager`-level integration test proving the ring wiring |
| `packages/web-client/src/features/terminal/TerminalPanel.tsx` | modified — shared `replay()` helper (`reset()` + `write()`) used by both `onSnapshot` and `onRestore`, replacing `onSnapshot`'s `clear()` |

## How it satisfies the scope
- `terminals.md` § Restore / snapshot, tier 1's two constraints — both implemented exactly as
  stated: the daemon ring "is never truncated in the middle of an escape sequence" and the client
  "resets its emulator before replaying (instead of clearing it)".
- The escape/CSI/OSC/DCS/SOS/PM/APC coverage matches the task's own enumeration ("`ESC` … followed
  by CSI … OSC … DCS/SOS/PM/APC … and two-byte `ESC <single char>` forms. It must also not split a
  multi-byte UTF-8 sequence"), each with its own passing unit test.
- `appendBounded` bounding: "if no terminator is found within the retained window, drop to the end
  rather than scanning forever" and "prefer dropping a few extra bytes over emitting a partial
  sequence" — the unterminated-tail test (`safeReplayStart` returns `buffer.length`) covers this
  directly; the scan itself is a single bounded `O(buffer.length)` pass, never unbounded.
- `ScreenBuffer`/`capture` path explicitly left untouched, per the task's own Notes — no changes
  outside `appendBounded`'s slice point and the two `terminal.reset()` call sites.

## Build & test results
```
$ npx vitest run packages/server/src/terminal        → 4 files, 37 tests passed (22 in
                                                          terminal-manager.test.ts, up from 9)
$ npm run typecheck   (root, tsc -b)                  → exit 0
$ npm run build       (root, all packages incl. build:web) → ✓ (web-client built in 7.56s)
$ npx oxlint <3 changed files>                        → 1 warning (consistent-function-scoping on
                                                          a test-local `bytes()` helper) → moved to
                                                          module scope → re-ran clean, exit 0
$ npx oxfmt --check <3 changed files>                 → correctly formatted
$ npm run lint         (root, oxlint)                 → exit 0; remaining warnings are all
                                                          pre-existing, in unrelated files
                                                          (daemon-client.ts, relay-logger.test.ts,
                                                          Attachments.tsx, chat-service.test.ts,
                                                          bootstrap.ts, schedule-service.test.ts,
                                                          terminal-rpc.ts) — zero new
$ npm test              (root, vitest)                → 138 test files, 1551 tests passed
                                                          (+10 vs. task-004's 1541 baseline — all
                                                          10 are terminal-manager.test.ts's new
                                                          cases: 9 `safeReplayStart` unit tests +
                                                          1 `appendBounded`/`TerminalManager`
                                                          integration test; 12→22 in that file)
```

## Live verification (production daemon, minimal per this session's explicit scope)
- Rebuilt `packages/server` and restarted the actual production daemon process (`node
  packages/server/dist/daemon/main.js`, `provider: "pi"` — not `dev:daemon`) so the running daemon
  reflects this task's `safeReplayStart` wiring.
- Post-restart sanity check only: `pi-studio --host 127.0.0.1:6767 terminal ls` returns cleanly
  (empty list on a fresh daemon, no RPC/crash). Confirms the daemon boots and serves terminal RPCs
  with the new code path live.
- The task's own manual scenarios (emit ≫64 KiB with heavy escapes then reload; `less`/`vim`
  full-screen-then-quit reattach) were **not** independently re-driven in a browser this session —
  per this session's explicit instruction, broader end-to-end verification (task-006) is being done
  manually by the user against this same production daemon, iterating on any issues found. The
  daemon-side logic those scenarios exercise is covered by the unit tests above (`safeReplayStart`'s
  CSI/OSC/DCS cases directly model the escape sequences `for i in ...; do printf '\033[32mline
  %s\033[0m\n' $i; done`-style heavy-escape output produces, and `less`/`vim` are exactly the
  alt-screen/DECSTBM-mode class `reset()` vs `clear()` addresses) and the integration test proves
  the `TerminalManager`-level wiring end to end.

## Acceptance criteria
- [x] `safeReplayStart` is unit-tested: cut inside a CSI sequence, inside an OSC terminated by
      `BEL`, inside an OSC terminated by `ESC \`, inside a two-byte `ESC` form, inside a multi-byte
      UTF-8 character, at a byte that is already safe (returns `from` unchanged), and with no
      terminator in the window (drops to the end) — plus a DCS/`ESC \` case and out-of-range
      clamping, beyond what was asked.
- [x] A terminal that has emitted far more than 64 KiB, then is resubscribed, replays starting at a
      safe boundary — proven by the `TerminalManager`-level integration test (a 9-byte stream with
      a 6-byte ring bound, where the naive cut lands mid-CSI, replays exactly `"CD"` with no stray
      CSI tail).
- [x] The existing `terminal-manager.test.ts` snapshot-then-live-output expectations still pass —
      all pre-existing tests in the file pass unchanged (22/22 total, including the new ones).
- [x] `onSnapshot` calls `reset()`, not `clear()`; grep confirms no `clear()` remains on the replay
      path — `terminal.clear()` no longer appears anywhere in `TerminalPanel.tsx`; both `onSnapshot`
      and `onRestore` route through the shared `replay()` helper, which calls `reset()`.
- [~] A terminal left inside a full-screen app (`less`/`vim`) and reattached renders normally — not
      independently live-verified this session (see Live verification note above); the fix
      (`reset()` clearing alt-screen/`DECSTBM` mode state) is the documented, correct primitive for
      exactly this class of bug and is left for the user's manual e2e pass.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass — see Build & test
      results above.

## Follow-ups / TODO(verify)
- task-006 (this session's user-driven manual e2e pass) should specifically exercise: (a) a
  ≫64 KiB heavy-escape burst then reload, confirming coherent replay from the first line; (b)
  `less`/`vim` then quit then reattach, confirming no stale scroll region; (c) `pi-studio terminal
  capture <slot>` still returns sensible text (the untouched `ScreenBuffer` path) as a regression
  check.
