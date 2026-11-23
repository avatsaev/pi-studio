# Task 003 — Documents and spec close for the app's self-update

- **Sprint:** sprints/sprint-134-desktop-update-release
- **Status:** backlog
- **Type:** docs
- **Area:** desktop/docs, desktop/AGENTS.md, packages/workbench docs, swe
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, sprint-133/task-003

## Goal
Every document says what the code does: the runbook for the key and releases, the new commands,
launch option, events, setting, `ui.inspect` part, host member, crates and dependencies.

## Scope references
- `desktop/docs/development.md` § Releasing (the key: where, lost, leaked; re-running a failed check;
  P15: users install 0.3.0 by hand once), `desktop/docs/architecture.md`, `desktop/docs/control-protocol.md`,
  `desktop/AGENTS.md` (crate map, commands, launch options), `desktop/README.md`
- `packages/workbench/AGENTS.md`, `README.md` (the `updates` member, the indicator)
- `swe/architecture/workbench-host-adapter.md` (the `updates` row: built)
- `swe/features/desktop-self-update.md` (status, ticks of what was seen), `docs/desktop-client-handoff.md`,
  `swe/MAIN-SCOPE.md`, `swe/sprints/PLAN.md` close note (orchestrator)

## Acceptance criteria
- [ ] No document states that the app cannot update itself, outside history.
- [ ] The release notes text in `desktop-release.yml` mentions that the app now updates itself.

## Test / verification plan
- `rg -n "update" desktop/AGENTS.md desktop/docs` reviewed; links resolve.
