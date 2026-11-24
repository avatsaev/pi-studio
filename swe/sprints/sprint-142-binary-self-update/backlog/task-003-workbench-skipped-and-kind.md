# Task 003 — Workbench: the skipped version and the `binary` kind in Settings → Daemon

- **Sprint:** sprints/sprint-142-binary-self-update
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench
- **Priority:** P2
- **Estimated size:** XS
- **Depends on:** task-001

## Goal
Settings → Daemon names the `binary` kind and, when `skippedVersion` is set, says "X was rolled back
and is not offered; Check now to try it again"; the dialog explains `unmanaged_binary` and links the
release page.

## Scope references
- `swe/features/self-update.md` § Workbench (Settings), `cannot_update.reason`
- `packages/workbench/src/features/` (the daemon update presentation and Settings → Daemon modules of sprint-137)

## What to build
Presentation only, in the existing pure presentation modules with their tests.

## Acceptance criteria
- [ ] Presentation tests for the three new cases; lint/typecheck clean.

## Test / verification plan
- `npx vitest run packages/workbench`

## Notes
The browser look is checked in sprint-145/task-001 with the dev daemon's scripted states (add
`PI_STUDIO_DEV_UPDATE=skipped` if needed, in `dev-update-script.ts`).
