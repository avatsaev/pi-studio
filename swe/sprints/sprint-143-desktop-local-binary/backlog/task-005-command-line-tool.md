# Task 005 — "Install the command-line tool"

- **Sprint:** sprints/sprint-143-desktop-local-binary
- **Status:** backlog
- **Type:** feature
- **Area:** desktop (engine, shell), packages/workbench (daemons)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-003, task-004

## Goal
`cli_tool.state` and `cli_tool.install` link `~/.local/bin/pi-studio` to the current binary and report
whether a new terminal will find it; the Daemons screen's local settings show the section.

## Scope references
- `swe/features/single-binary-daemon.md` § The command-line tool, `CliToolState`, D11, P5, S11
- `desktop/crates/engine/src/` (command registry), `desktop/crates/shell/src/shell_env.rs`, `daemons.rs`
- `packages/workbench/src/features/daemons/`, `desktop/apps/pistudiodesktop/src/host/daemons.ts`

## What to build
The state rules and install of the spec; never overwrite a file the app did not make; recapture the
login shell's environment after an install; a sentence per state on the screen (the start-up file line
for `not_on_path`, the other path for `shadowed`).

## Acceptance criteria
- [ ] Tests for every state (fake file system and shell lookup), including `occupied` refusing.
- [ ] `cargo xtask ci`, workbench tests green.

## Test / verification plan
- `cargo xtask ci`; `npx vitest run packages/workbench`

## Notes
Windows: `unavailable`.
