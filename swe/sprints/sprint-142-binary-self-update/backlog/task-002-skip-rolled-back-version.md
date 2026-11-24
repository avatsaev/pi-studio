# Task 002 — A rolled-back version is not offered again by automatic checks

- **Sprint:** sprints/sprint-142-binary-self-update
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (update)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001

## Goal
After an update ends `rolled_back` or `failed`, the daemon remembers that version and an automatic
check leaves the state `idle` for it; "Check now" offers it; a newer version clears it. All install kinds.

## Context / why
D14, closing the open item of milestone 5b.

## Scope references
- `swe/features/self-update.md` § `skippedVersion`, § Check (milestone 6 lines), § Error handling
- `packages/server/src/update/update-service.ts` (result read, check), its tests

## What to build
- On reading `update-result.json` with outcome `rolled_back` or `failed`: write
  `$PI_STUDIO_HOME/update-skip.json` `{version: to}`; load it at start; an unreadable file is removed
  and logged.
- `check(by)`: the two milestone-6 lines of the spec's pseudocode; `status.skippedVersion` set while
  the file holds a version.

## Out of scope
The workbench line (task-003).

## Acceptance criteria
- [ ] Tests: automatic check with latest == skipped → `idle`; manual → `available`; latest > skipped →
      `available` and the file removed; outcome `updated` writes nothing.

## Test / verification plan
- `npx vitest run packages/server/src/update`

## Notes
None.
