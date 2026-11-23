# Task 004 — Browser check of the update UI against the dev daemon's scripts

- **Sprint:** sprints/sprint-137-daemon-update-ui
- **Status:** backlog
- **Type:** test
- **Area:** packages/workbench, packages/web-client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003, sprint-136/task-006

## Goal
Every state of the pill, the dialog and the Settings panel is seen in a real browser, with two clients, and recorded.

## Context / why
The owner does not test by hand; the UI has no jsdom tests.

## Scope references
- `swe/features/self-update.md` § Workbench, § Acceptance criteria
- `packages/web-client` (vite) against `node packages/server/dist/daemon/dev-main.js` with `PI_STUDIO_DEV_UPDATE` set
- a results section in `packages/workbench/docs/` or the task summary, with screenshots under a scratch directory (not committed)

## What to build
- For each script (`available`, `cannot`, `fail`, `rollback`): the pill, the dialog's steps, the reconnect and the result; with a second browser tab connected: the same pill states and one result each.
- A terminal opened in the second tab is counted in the first tab's dialog.
- Unset: no pill, the category shows version and kind.
- A daemon without the flag (build the previous commit's server, or strip the flag with an env the dev daemon already has; else a unit proof): no pill and no category.

## Out of scope
The real npm path (sprint-136/task-005).

## Acceptance criteria
- [ ] All of the above seen; defects fixed in the owning files with tests and listed.
- [ ] Light and dark theme screenshots of the pill and the dialog.

## Test / verification plan
- `npm run build && npm run typecheck && npm run lint && npm test`

## Notes
Stop the scratch daemon and vite afterwards.
