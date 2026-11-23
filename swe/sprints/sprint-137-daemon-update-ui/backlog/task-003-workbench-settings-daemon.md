# Task 003 — Workbench: Settings → Daemon

- **Sprint:** sprints/sprint-137-daemon-update-ui
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench (features/settings)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal
A Settings category "Daemon" shows the version, install kind, last check, Check now, the automatic-check switch and the Update action.

## Context / why
Spec § Workbench (Settings → Daemon) (D7, D16).

## Scope references
- `swe/features/self-update.md` § Workbench
- `packages/workbench/src/features/settings/settings-categories.ts` (capabilities gain `daemonUpdate`), new `DaemonSettingsPanel.tsx` + css + a view module with tests

## What to build
- Category present only with the capability.
- Check now → `checkDaemonUpdate()` with a busy state and the `checkError` in words; the switch → `setDaemonUpdateAutoCheck`; Update opens task-002's dialog.

## Out of scope
Anything about the desktop app's own update.

## Acceptance criteria
- [ ] View tests: each state's rows; the switch's optimistic state reverts on an error.

## Test / verification plan
- `npx vitest run packages/workbench`
- `npm run build:workbench && npm run typecheck && npm run lint`

## Notes
Docs: `packages/workbench/AGENTS.md`, `README.md` if it lists settings categories.
