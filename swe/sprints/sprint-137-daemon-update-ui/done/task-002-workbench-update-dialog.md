# Task 002 — Workbench: the update dialog (confirm with counts, progress, result)

- **Sprint:** sprints/sprint-137-daemon-update-ui
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (features/daemon-update)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
The pill opens a dialog that confirms with the counts, shows the stages, survives the reconnect and shows the result once.

## Context / why
Spec § Workbench (Dialog, Reload note, Other clients) (D4, D7, D10, D14).

## Scope references
- `swe/features/self-update.md` § Workbench
- new `packages/workbench/src/features/daemon-update/` (`DaemonUpdateDialog.tsx` + css, `daemon-update-dialog-view.ts` + test, `use-update-impact.ts`), the UI store, the app root that mounts dialogs

## What to build
- Pure view function: (status, impact counts, page version, host kind, shown-result marker) → what the dialog shows; all texts of the spec.
- Counts: running agents from the session store; terminals from `list_terminals_request` on open and `terminals_update`.
- After the reconnect: when `lastResult.at` is newer than the stored marker, open the result once and store the marker (per daemon, in the workbench's stored state through the host's storage).
- Reload button and note only when the host is a browser and the page's version differs from the daemon's.
- `cannot_update`: reason text and the command with a copy button; `failed`: message, command, Retry (a check, then apply).

## Out of scope
Settings (task-003).

## Acceptance criteria
- [ ] View tests for: confirm with counts 0/0 and N/M, each stage, restarting while disconnected, updated, rolled back, failed, each cannot_update reason, the reload note on and off.
- [ ] A refusal `in_progress` shows the running update instead of an error.

## Test / verification plan
- `npx vitest run packages/workbench`
- `npm run build:workbench && npm run typecheck && npm run lint`

## Notes
Focus stays in the dialog; Escape closes it except while restarting. Docs: `packages/workbench/AGENTS.md`.
