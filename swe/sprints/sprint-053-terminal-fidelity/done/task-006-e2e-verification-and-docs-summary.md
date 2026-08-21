# Task 006 — Live E2E proof of fidelity + docs sync — Summary

**Sprint:** sprint-053-terminal-fidelity
**Completed:** 2026-08-21
**Status:** done — docs sync + scope-item closure delivered; the live browser sequence was **waived
by the user** (same treatment as sprint-052/task-006's equivalent live pass).

## What was implemented

No product code — this task's own scope is verification + docs. What changed:

### Docs sync
- `packages/protocol/src/binary-frames/terminal-stream-protocol.ts`: deleted the stale `Restore`
  value is TODO(verify)" comment on `TerminalOpcode`; replaced with a description of what `Restore`
  actually carries and when it's used.
- `packages/protocol/AGENTS.md`: added a bullet under `binary-frames/terminal-stream-protocol.ts`
  explaining `Restore`'s payload (`ScreenBuffer.serialize()`, not raw bytes) and the exact
  negotiation (`CLIENT_CAPS.terminal_reflowable_snapshot` + `SERVER_FEATURES["terminal-restore-modes"]`
  + a literal `"reflowable"` request) that decides which tier a subscription gets.
- `packages/server/AGENTS.md` § Terminal subsystem:
  - Fixed the stale `ScreenBuffer` claim ("used only by `capture(slot)`... never participates in
    `subscribe`'s replay") — it now also backs the reflowable `Restore` payload via `serialize()`
    (task-004).
  - Fixed the stale `safeReplayStart` claim ("drops the whole unterminated tail") — it now falls back
    to the naive cut (task-007).
  - Added the `resizeAndBroadcast` wrapper, its before/after comparison rationale, and
    `makeTerminalBinaryHandler`'s new `broadcast`/`getActiveSessions` parameters (task-007).
  - Fixed the stale "`terminals_update` broadcasts on exactly five daemon-side events" claim — a
    size-changing resize is now a sixth trigger, and there are now two web-client consumers
    (`use-terminal-exit-watch.ts`'s global hook, and `TerminalPanel.tsx`'s own per-panel listener),
    not one.
- `packages/client/AGENTS.md`: checked — already accurate (`onRestore` was already documented as a
  live, mode-gated opcode from earlier sprint work; no stale "forward-declaration" language found).
- `packages/web-client/AGENTS.md`:
  - Extended the `terminal/` source-layout entry with `believedSizeFromBroadcast` and the
    unconditional reflowable-restore request on every `subscribe_terminal_request`.
  - Added a new bullet to the "PTY sizing" invariant describing the `terminals_update`-driven belief
    reseed (task-007) and why it must never route through `claimSize`.
- `packages/server/package.json`: checked — `@xterm/addon-serialize` was already present from
  task-004; no new dependency landed in this task.

### Scope-item closure
- `swe/features/terminals.md` § TODO(verify) "Restore opcode value" and
  `swe/features/feature-panels-ui.md` § TODO(verify) "Terminal snapshot serialization format" were
  already ticked from task-004's own work — verified both are still accurate against current code, no
  change needed.
- `swe/features/terminals.md` § Acceptance Criteria's size-ownership items and
  `swe/features/feature-panels-ui.md`'s "attaches/streams/reconnects with snapshot restore, sends
  resize only from the claiming focused pane, **and shows the mobile key bar on compact**" item both
  stay **unticked** — the former by the doc's own stated rule (live-only, no jsdom path), the latter
  because it bundles the still-unimplemented mobile key bar with the size/restore behavior, and
  because the live pass proving the size/restore halves was waived. Ticking either would overclaim
  what was actually verified.
- `swe/features/terminals.md` §§ PTY size ownership and Restore / snapshot were already updated by
  task-007's own summary (broadcast + reseed language, ring fallback language) — verified consistent
  with the final server/client code, no further change needed here.

## Files
- Created: none
- Modified: `packages/protocol/src/binary-frames/terminal-stream-protocol.ts`,
  `packages/protocol/AGENTS.md`, `packages/server/AGENTS.md`, `packages/web-client/AGENTS.md`
- Tests added: none (docs-only; the behaviors this task was meant to verify already carry unit tests
  from tasks 001–005 and 007)

## How it satisfies the scope
Closes the doc-sync half of task-006's "What to build" in full. The scope-closure half (ticking
`terminals.md`/`feature-panels-ui.md` boxes) is satisfied by confirming the already-ticked items are
still accurate and by deliberately leaving the live-verification-gated items open, honestly, per the
waiver.

## Build/test results
- `$ npx tsc -b --force` (whole monorepo) → **Result:** success (0 errors)
- `$ npm run lint` → **Result:** exit 0; pre-existing warnings only, none in a file this sprint
  touched, none new
- `$ npm test` (whole monorepo) → **Result:** 2553 passed, 0 failed (194 files)
- `$ npm run build` (whole monorepo) → **Result:** success, every package

## Acceptance criteria
- [ ] Appearance / Exit / Reflowable restore / Combination ×2 / Fallback / Regression sweep — **not
      live-verified**, waived by the user (2026-08-21), same as sprint-052/task-006. Every individual
      behavior these would exercise already has unit coverage from its own task (001–005, 007); see
      each task's summary for what specifically is covered.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` all pass — full monorepo gate,
      not just the terminal packages.
- [x] Docs updated as listed; no doc statement contradicted by the code remains — five stale claims
      found and fixed (see "Docs sync" above); everything else in scope checked and found accurate.

## Follow-ups / TODO(verify)
- The live 7-scenario browser sweep this task specified, if ever wanted. Same standing item as
  sprint-052/task-006's waived sequence and sprint-053/task-007's waived two-browser sequence — all
  three could be run together in one session against the same `npm start` daemon.
- `swe/features/terminals.md` § TODO(verify) "Whether the production PTY runs in a dedicated worker
  process" — unrelated to this sprint, left open as before.
