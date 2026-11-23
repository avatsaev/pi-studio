# Task 002 — Desktop host: `updates` over `boot`, `update_changed` and `engine_command`

- **Sprint:** sprints/sprint-133-desktop-update-ui
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src/host
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, sprint-132/task-002

## Goal
The desktop host implements `updates` from the `boot` answer and the `update_changed` event, and its
actions call `engine_command` with `update.*`.

## Context / why
Spec § 5, P1. Golden rule 1 (no network call in the frontend).

## Scope references
- `swe/features/desktop-self-update.md` § 5
- New `desktop/apps/pistudiodesktop/src/host/updates.ts` (+ test), `boot.ts`, `desktop-host.ts`,
  `ipc.ts`

## What to build
- Parse `boot.update` and the event payload strictly (a bad payload → `idle`); subscribe/unsubscribe;
  `check/install/restart` → `engine_command('update.check'|…)`; a refusal rejects with its reason.

## Acceptance criteria
- [ ] Tests: parsing of every state and a malformed one; the three actions call the right ids;
  listener removal.
- [ ] `npm run check && npx vitest run src` in `desktop/apps/pistudiodesktop`; `npm run snapshot` passes.

## Test / verification plan
- `cd desktop/apps/pistudiodesktop && npm run check && npx vitest run src && npm run snapshot`
