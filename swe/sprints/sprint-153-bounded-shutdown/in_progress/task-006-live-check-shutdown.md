# Task 006 — Live check of shutdown, and the update recipes

- **Sprint:** sprints/sprint-153-bounded-shutdown
- **Status:** in_progress
- **Type:** test
- **Area:** packages/server, scripts, docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-004, task-005

## Goal
A stop under load seen finishing in time with nothing left behind, and the two update recipes re-run.

## Context / why
The handoff's warning on improvement 5: the update pipeline ends in this shutdown. Run on a throwaway
daemon (temporary homes, a spare port, only the `litellm` API key copied); never the owner's daemon.

## Scope references
- `docs/daemon-audit-handoff.md` § Approved improvements (row 5)
- `scripts/daemon-update-check/` and `scripts/binary-update-check/` (their READMEs; a clean worktree)
- `packages/server/docs/daemon-update-live-results.md`

## What to build
Run and record:
1. **Stop under load:** a turn running on a real Pi, a terminal running a long command, an extension
   or skill install in progress, and one client that has stopped reading. `pi-studio daemon stop`:
   time to exit, PID file gone, no process left that names the temporary home.
2. **A second SIGTERM** during the stop exits at once.
3. **A second daemon on the same port** exits, and the first one's PID file is unchanged.
4. **Requests during the stop** are answered `shutting_down`.
5. `scripts/daemon-update-check/` and `scripts/binary-update-check/`, results added to the live
   results file.
Docs: `packages/server/AGENTS.md` (shutdown), root `AGENTS.md`, `swe/architecture/daemon-bootstrap.md`.
Full gates, and `cd desktop && cargo xtask ci`.

## Acceptance criteria
- [ ] All five recorded; gates green.

## Test / verification plan
As above.
