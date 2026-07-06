# Task 005 — Schedules screen & command-center wiring

- **Sprint:** sprint-019-navigation-screens
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-002; sprint-013/task-005 (schedules + command center models)

## Goal
Build the cross-host `/schedules` screen and finish wiring the command center's navigation/actions to
the now-existing screens.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § schedules, § command center
- `clean-room-scope/features/schedules-heartbeats.md`

## What to build
- `/schedules` (+ `/h/:serverId` scope): list schedules/heartbeats grouped by host, with active/ended
  filters, next-run/last-run, enable/disable + run-now actions; consume the sprint-013 schedules model.
- Per-filter empty-state copy (host × active/ended) — TODO(verify) exact strings.
- Command-center action wiring: register navigation targets (open sessions/schedules/settings/new,
  switch host, open recent workspace) now that the screens exist; verify keyboard execution routes.

## Out of scope
- Creating schedules from the composer (composer sprint-021). Workspace shell (sprint-020).

## Acceptance criteria
- [ ] `/schedules` lists schedules grouped by host with active/ended filters and enable/disable/run-now
      (mock client).
- [ ] Empty states render per filter combination.
- [ ] Command-center entries navigate to the real screens and execute via keyboard.

## Test / verification plan
- Tests: schedules grouping/filter + action dispatch (reuse model); command-center target registry →
  route resolution.

## Notes
- Closes the navigation-screens sprint; sprint-020 begins the in-workspace UI.
