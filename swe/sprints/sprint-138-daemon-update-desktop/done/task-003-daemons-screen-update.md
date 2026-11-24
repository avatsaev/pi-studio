# Task 003 — Workbench and desktop host: Update on the Daemons screen; the outdated toast opens it

- **Sprint:** sprints/sprint-138-daemon-update-desktop
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (features/daemons), desktop/apps/pistudiodesktop/src/host
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, sprint-137/task-003

## Goal
The Daemons screen shows Update for an outdated or stopped local or SSH entry, with the updating state and the failure text; the outdated-daemon toast opens the screen.

## Context / why
Spec § Desktop, § Workbench (last bullet).

## Scope references
- `swe/features/self-update.md` § Desktop, § Workbench
- `packages/workbench/src/features/daemons/` (`daemon-presentation.ts`, `daemons-screen-view.ts` + tests), `packages/workbench/src/host/types.ts` (the daemons member gains `update(id)`), `packages/workbench/src/features/connection/use-outdated-daemon-notice.ts`
- `desktop/apps/pistudiodesktop/src/host/daemons.ts`, `daemons-view.ts` (+ tests)

## What to build
- Host member: `updateLocal()` / `updateRemote(id)` calling the two commands; the new `updating` state parsed.
- Screen: the Update button beside the npm command for `cli_outdated`, and beside Start for a stopped entry; a spinner row while updating; the failure's last lines.
- Toast: its action opens the Daemons screen.

## Out of scope
The browser host (it has no daemons member).

## Acceptance criteria
- [ ] View tests for each state; host parse tests.

## Test / verification plan
- `npx vitest run packages/workbench desktop/apps/pistudiodesktop/src`
- `cd desktop && cargo xtask ci`
- `cd desktop/apps/pistudiodesktop && npm run snapshot` (restore `snapshot.png`)

## Notes
Docs: `packages/workbench/AGENTS.md`, `README.md` host table.
