# Task 004 — Schedule detail view

- **Sprint:** sprint-030-integration-gap-closure
- **Status:** done
- **Estimated size:** S
- **Depends on:** sprint 019 (schedules screen), sprint 010 (schedules/heartbeats daemon)

## Goal
Build the schedule detail view noted as "not yet built" in
`packages/app/src/router/LivePages.tsx` (~line 104). The Schedules screen currently lists
schedules but has no detail/edit surface.

## Scope references
- `clean-room-scope/features/schedules-heartbeats.md`
- `clean-room-scope/features/app-navigation-screens.md` § schedules

## What to build
- A schedule detail panel/route showing: cron/interval spec, target agent/prompt, last-run and
  next-run times, run history/status, active/paused toggle.
- Actions: pause/resume, run-now, edit spec, delete — wired to the existing schedules SDK methods.
- Empty/loading/not-found states reusing shared primitives.

## Acceptance criteria
- [ ] Selecting a schedule opens a detail view with its full config + run info.
- [ ] Pause/resume/run-now/delete call the correct SDK methods and reflect optimistic state.
- [ ] Next-run time displays correctly for both cron and interval schedules.

## Test / verification plan
- Unit: next-run formatting for cron vs interval.
- Component: mock schedule → verify fields; action buttons → verify SDK calls.
- `npx vitest run`; `npm run build:web` succeeds.
