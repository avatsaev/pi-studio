# Task 006 — Live E2E proof of fidelity + docs sync

- **Sprint:** sprint-053-terminal-fidelity
- **Status:** done — docs sync + scope-item closure delivered; the live browser sequence was
  **waived by the user on 2026-08-21** (same treatment as sprint-052/task-006's equivalent live
  pass), so the acceptance criteria below stay accurately unticked where they depend on it.
- **Type:** test + docs
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005

## Goal
Verify appearance conformance, exited-terminal state, and the reflowable restore tier together against
a real daemon in a real browser; close the remaining terminal acceptance/TODO items in the scope; sync
the docs.

## Background / why
The three strands of this sprint interact in ways no single task's verification covers: a font-size
change alters cell metrics **and** claims a new size **and** changes what a subsequent restore must be
laid out for; an exited terminal must not be restored on the next connect; a `Restore` frame must land
in an emulator whose theme and font came from the appearance system. Those combinations are the point of
this task.

It also closes the scope items this sprint resolves — `terminals.md` § Restore / snapshot tier 2 and
`feature-panels-ui.md` § TODO(verify) "Terminal snapshot serialization format" — which must be recorded
against what was actually built, not against the plan.

## Scope references
- `swe/features/terminals.md` § Restore / snapshot, § Acceptance Criteria, § TODO(verify)
- `swe/features/feature-panels-ui.md` § Terminal pane, § States, § Error Handling & Edge
  Cases, § Acceptance Criteria, § TODO(verify)
- `swe/architecture/design-system.md` § Colors
- `packages/server/AGENTS.md` § Terminal subsystem
- `packages/web-client/AGENTS.md` (`features/terminal/`, `theme/`, invariants)
- `packages/protocol/AGENTS.md` § `binary-frames/terminal-stream-protocol.ts`, § capability tables
- `packages/client/AGENTS.md` § `TerminalStreamRouter`

## What to build
No product code beyond fixes for what the sequence uncovers. Deliverables:

- **Verification record** in the summary: each numbered step, commands run, observed result. Frame
  opcodes, `stty size` output, and `pi-studio terminal ls` output are the evidence.
- **Docs sync:**
  - `packages/protocol/AGENTS.md` — `Restore = 0x05` is now a live, emitted opcode with a defined
    payload (name it); `CLIENT_CAPS.terminal_reflowable_snapshot` and
    `SERVER_FEATURES["terminal-restore-modes"]` are now actually exercised, and by whom.
  - `packages/protocol/src/binary-frames/terminal-stream-protocol.ts:15` — delete the stale
    "`Restore` value is TODO(verify) against the live codec" comment: the value is confirmed in the
    scope and, as of this sprint, exercised live.
  - `packages/server/AGENTS.md` § Terminal subsystem — the two restore tiers, which frame each serves,
    where the serialization comes from (`ScreenBuffer` + the addon/mechanism chosen in task-004) and its
    scrollback bound; the new exit notification seam and the five paths that broadcast
    `terminals_update` (create/rename/kill/start_workspace_script/exit).
  - `packages/client/AGENTS.md` — `TerminalStreamRouter.onRestore` is a live path now, not a
    forward-declaration.
  - `packages/web-client/AGENTS.md` — the terminal follows the appearance system (theme
    `colors.terminal`, scaled font size, `fontFamily.mono`) and refits+claims on a font change; the
    exited state; the reflowable subscription; the new theme context/hook in `theme/`.
  - `packages/server/package.json` dependency note if a new dependency landed in task-004.
- **Close the scope items:** tick the tier-2 acceptance criteria in `terminals.md`, resolve
  `feature-panels-ui.md` § TODO(verify) "Terminal snapshot serialization format" with the format actually
  implemented, and tick § Acceptance Criteria "The terminal attaches/streams/reconnects with snapshot
      restore, sends resize only from the claiming focused pane" — **both halves are proven here**: the
      size half's live pass was waived when sprint-052/task-006 closed (2026-08-21), so this task's
      regression sweep is the size contract's first systematic live proof, not a re-run of one.

## Out of scope
- The mobile virtual key bar, xterm link provider, and search addon from `feature-panels-ui.md`
  § Terminal pane — unimplemented and unrelated to this sprint; leave their acceptance items open.
- The renderer addon question (see the sprint's open questions in `PLAN.md`).
- The two CLI defects noted in sprint-052/task-006's summary.

## Acceptance criteria
Run in one session against `npm start` and a real browser:

- [ ] **Appearance.** Dark→light→dark: the terminal follows, background matches the wrapper with no
      seam, zero `Resize` frames, scrollback intact. Font size 16→10→24: text rescales, one `Resize` at
      rest per change, `stty size` and the shell's wrap column track each time. Custom mono font applies.
- [ ] **Exit.** `exit` marks the tab exited with the final screen readable and input dead; the other open
      terminal is unaffected; `pi-studio terminal kill` produces the same; closing an exited tab errors
      nowhere; a reconnect never marks a live terminal exited.
- [ ] **Reflowable restore.** A subscription reports the reflowable tier and receives `Restore` (`0x05`)
      with no `Snapshot`; reattach after a substantial width change renders correctly at the new width;
      colours and cursor position survive.
- [ ] **Combination.** Produce output, change the font size (new width claimed), reload → the restore is
      laid out for the *current* width, not the width the output was produced at.
- [ ] **Combination.** `exit` a terminal, then reload → it does not come back as a tab
      (`use-terminal-restore.ts` skips closed entries), and no phantom subscription is attempted.
- [ ] **Fallback.** With `restoreModesEnabled: false` (temporarily), everything still works via
      `Snapshot`, including after a width change (approximate layout is expected and acceptable there).
- [ ] **Regression sweep.** Everything sprint-052 shipped still holds: fresh-open sizing, long-command
      editing with no ghosts, one `Resize` per drag, no `Resize` on passive attach, escape-safe replay.
      Plus: `pi-studio terminal ls/create/capture/send-keys` unaffected, agent chat / file viewer / git
      panels unaffected.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` all pass at the end of the sprint.
      (2553 tests, 194 files, full monorepo; `npx tsc -b --force` clean; `npm run lint` exit 0, no new
      warnings in any file this sprint touched; `npm run build` succeeds for every package.)
- [x] Docs updated as listed; no doc statement contradicted by the code remains. See this task's
      summary for the full per-file list of what changed and why.

## Test / verification plan
- Full gates: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
- Live: the acceptance sequence above, with the devtools WS frame list open for opcodes and counts, and
  `stty size` / `pi-studio terminal ls` as independent oracles.
- Record everything in `done/task-006-e2e-verification-and-docs-summary.md`.

## Notes
Re-run sprint-052's regression items here rather than trusting them — doubly so since that sprint's own
live sequence was waived at close (its automated gates and ad-hoc field reports are what stand behind
it): task-002 changes the emulator's
construction options and task-005 changes what arrives on subscribe, both of which sit directly on the
size path that sprint fixed.

Task-007 (resize broadcast + ring degradation) executes **after** this task in numeric order — it was
appended from sprint-052's review, not part of the original plan shape. It carries its own unit tests,
manual sequence, and `terminals.md` updates, so this task must not tick or touch the two
known-limitation bullets (multi-client belief drift, drop-all ring trim) that task-007 removes.
