# Task 004 — Schedule detail view — Summary

- **Sprint:** sprint-030-integration-gap-closure
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented
Built the schedule detail view previously stubbed as "not yet built" in `LivePages.tsx`. Selecting
a schedule from the Schedules list opens an adaptive sheet/dialog showing cadence (cron vs interval),
status, next/last run times, target, run-history summary, and the prompt. The dialog exposes
pause / resume / run-now / delete actions wired to the existing `useScheduleMutation` hook (which
self-invalidates the schedules query on success).

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/screens/schedule-detail.ts` | created — cadence/status/timestamp/run-summary/action logic |
| `packages/app/src/screens/schedule-detail.test.ts` | added — 11 tests |
| `packages/app/src/components/screens/ScheduleDetailDialog.tsx` | created — presentational detail sheet |
| `packages/app/src/router/LivePages.tsx` | modified — `LiveSchedulesPage` opens the dialog + wires mutations |

## How it satisfies the scope
- `features/schedules-heartbeats.md`: detail shows the full config + run info; pause/resume map to
  `pause_schedule_request`/`resume_schedule_request`, run-now to `schedule_run_once_request`, delete
  to `delete_schedule_request` (via `useScheduleMutation`).
- Next-run formatting handles both cron and interval cadence (`cadenceLabel` / `cadenceKind`), with
  a relative-delta timestamp helper — covered by unit tests.
- Action availability is status-gated (`resolveScheduleDetailActions`): active → pause, paused/
  disabled → resume.

## Build & test results
```
$ npx tsc -p packages/app/tsconfig.json --noEmit          # exit 0

$ npx vitest run packages/app/src/screens/schedule-detail.test.ts
Test Files  1 passed (1)   Tests  11 passed (11)

$ npx vitest run packages/app
Test Files  75 passed (75)   Tests  1286 passed (1286)

$ npm run build:web        # (packages/app)  ✓ built
```

## Acceptance criteria
- [x] Selecting a schedule opens a detail view with its full config + run info. (`ScheduleDetailDialog`)
- [x] Pause/resume/run-now/delete call the correct SDK methods and reflect optimistic state. (wired to `useScheduleMutation`; query invalidated on success)
- [x] Next-run time displays correctly for both cron and interval schedules. (`cadenceLabel`/`formatTimestamp`, unit-tested)

## Follow-ups / TODO(verify)
- Run history is shown as a summary (counts). A full per-run log list (via `useScheduleHistory` /
  `schedule_logs_request`) can be added when the daemon populates run outputs.
- The detail opens as an overlay rather than a dedicated route; if a deep-linkable
  `/schedules/:id` route is desired later, add it to the route grammar.
