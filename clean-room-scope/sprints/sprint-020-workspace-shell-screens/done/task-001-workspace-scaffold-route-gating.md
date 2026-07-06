# Task 001 — Workspace screen scaffold & route gating

- **Sprint:** sprint-020-workspace-shell-screens
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** sprint-019; sprint-014/task-004 (route gating), sprint-014/task-003 (composition)

## Goal
Build the `/h/:serverId/workspace/:workspaceId` screen container and render the route-gate state machine
(splash/reconnecting/unreachable/loading/missing/foreign/directory-missing → ready).

## Scope references
- `clean-room-scope/features/workspace-ui.md` § route gating, § screen composition

## What to build
- The workspace route component: resolve the workspace entry, drive the sprint-014 route-gate model, and
  render the matching gate UI (splash, reconnecting, unreachable-with-retry, loading, missing, foreign-
  host, directory-missing) or the ready workspace shell.
- The workspace shell frame: header slot + tab-strip slot + pane-area slot + explorer-sidebar slot
  (filled by later tasks/sprint-022), wired to the sprint-014 composition model.
- Persisted per-client layout load on entry (sprint-014 layout store) + seeding an empty draft when the
  workspace has no tabs (sprint-014 seeding model).

## Out of scope
- Tab strip (task-002). Panes/splits (task-003). Header/switcher/bulk-close (task-004). Panel bodies
  (sprint-021/022).

## Acceptance criteria
- [ ] Each gate state renders its documented UI; retry/reconnect transitions work.
- [ ] On ready, the shell frame mounts with the persisted layout (or a seeded draft tab).
- [ ] Foreign-host / directory-missing states match the model.

## Test / verification plan
- Tests: gate state machine → rendered state (reuse sprint-014 model); layout load + empty-seed on entry.

## Notes
- The shell frame's slots are filled by tasks 002–004 and sprint-022 panels.
