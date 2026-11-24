# Task 005 — Live check: a binary daemon updates itself and rolls back

- **Sprint:** sprints/sprint-142-binary-self-update
- **Status:** backlog
- **Type:** test
- **Area:** binary, update
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, task-004, sprint-140/task-003

## Goal
In a Linux container, two locally built binaries served by a local HTTP server prove update, rollback,
the skipped version and `unmanaged_binary`, with clients reconnecting.

## Scope references
- `swe/features/self-update.md` § Acceptance criteria (milestone 6)
- Pattern: `scripts/daemon-update-check/` and `packages/server/docs/daemon-update-live-results.md`

## What to build
Build version N and N+1 (and a broken N+2 whose daemon exits at start) with `build:binary`; serve them
with a manifest; install N into the layout; with `PI_STUDIO_DAEMON_UPDATE_URL`:
- a direct client and the workbench see the pill; Update → N+1 on the same address; clients reconnect;
- N+2 → rolled back to N+1; the next automatic check does not offer N+2, "Check now" does;
- a binary run from another folder → `cannot_update(unmanaged_binary)`;
- a corrupted asset → `failed`, the daemon keeps running.
Record in `packages/server/docs/daemon-update-live-results.md` (a new dated section). Extend
`scripts/daemon-update-check/` if it fits; otherwise a sibling script.

## Acceptance criteria
- [ ] All rows recorded with outcomes; defects fixed with tests.

## Test / verification plan
- The script's run output in the summary.

## Notes
None.
