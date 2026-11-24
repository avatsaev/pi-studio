# Task 005 — Documents and spec close for the daemon self-update

- **Sprint:** sprints/sprint-138-daemon-update-desktop
- **Status:** done
- **Type:** docs
- **Area:** docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004, sprint-137/task-004

## Goal
Every document that describes updating or restarting the daemon is true; the spec's criteria are ticked from evidence.

## Context / why
Docs are deliverables.

## Scope references
- `swe/features/self-update.md` § Acceptance criteria, § TODO(verify)
- root `AGENTS.md` (Protocol overview bullet for `daemon_update_*`, env table, persistence layout), `README.md`, `packages/cli/README.md`, `fern/pages` (CLI, daemon configuration, Docker), `docker/README.md`, `packages/{server,protocol,client,workbench,cli}/AGENTS.md`, `desktop/AGENTS.md`, `docs/desktop-client-handoff.md` (5b state), `swe/features/self-update.md`, `swe/MAIN-SCOPE.md`, `swe/sprints/PLAN.md` close note

## What to build
- Update each; tick the spec's acceptance criteria that were seen and name what was not; resolve the TODO(verify) items from the live runs.
- `fern check` when the fern CLI is available.

## Out of scope
New behavior.

## Acceptance criteria
- [ ] A grep for `npm i -g @av-pi-studio/cli` and `daemon restart` finds no statement that is now untrue.
- [ ] Full gates pass.

## Test / verification plan
- `npm run build && npm run typecheck && npm run lint && npm test`
- `cd desktop && cargo xtask ci`

## Notes
None.
