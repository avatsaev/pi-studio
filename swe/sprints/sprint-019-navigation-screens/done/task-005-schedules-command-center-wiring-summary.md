# Task 005 — Schedules Screen & Command-Center Wiring — Summary

- **Sprint:** sprint-019-navigation-screens
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

| Component / Change | What it does |
|--------------------|-------------|
| `SchedulesScreen` | `/schedules` cross-host schedule list; Active/Ended segmented filter, host filter (hidden when 1 host); loading/empty/list states; "New schedule" button |
| Command center wiring | Added `sessions` and `schedules` to `STATIC_COMMAND_ACTIONS`; all navigation targets now resolve to real screen routes |
| `StaticCommandAction.id` type | Extended union to include `"sessions" \| "schedules"` |

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/components/screens/SchedulesScreen.tsx` | created |
| `packages/app/src/components/screens/SchedulesScreen.module.css` | created |
| `packages/app/src/components/screens/index.ts` | added SchedulesScreen export |
| `packages/app/src/screens/command-center.ts` | extended `StaticCommandAction.id` + added sessions/schedules actions |
| `packages/app/src/screens/cross-host-command-center.test.ts` | fixed index-based test → `find()` by id |
| `packages/app/src/components/screens/screens.test.ts` | added 10 tests (schedule bucket/aggregation + command-center wiring) |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck
# 0 errors

$ npx vitest run packages/app/src/components/screens/screens.test.ts
# 62 passed

$ npx vitest run
# 95 files, 1167 tests passed

$ npm --workspace @av-pi-studio/app run build:web
# ✓ 387 kB, built in 783ms
```

## Acceptance criteria
- [x] `/schedules` lists schedules grouped by host with active/ended filters and enable/disable/run-now (mock client).
- [x] Empty states render per filter combination ("No active schedules" / "No ended schedules").
- [x] Command-center entries navigate to the real screens and execute via keyboard.

## Follow-ups / TODO(verify)
- ScheduleFormSheet (create/edit schedule bottom-sheet) deferred to sprint-021 when composer surface is available.
- Run-now / enable/disable actions wire to mock callbacks; real RPC integration in sprint-020+.
- Empty state exact copy per host×filter — currently generic; refine if product spec becomes available.
