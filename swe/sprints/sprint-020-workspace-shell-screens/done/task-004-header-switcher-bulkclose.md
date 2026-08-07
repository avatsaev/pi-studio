# Task 004 — Workspace header, compact switcher & bulk-close

- **Sprint:** sprint-020-workspace-shell-screens
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-003; sprint-014/task-003,004 (header/actions, mobile switcher, bulk-close)

## Goal
Build the workspace header (title/actions: Scripts, Open-in-editor, Explorer toggle, Focus), the compact
single-pane tab switcher, and the bulk-close confirmation flow.

## Scope references
- `clean-room-scope/features/workspace-ui.md` § header & actions, § compact switcher, § bulk close

## What to build
- `WorkspaceHeader`: workspace title/subtitle, script runner menu, open-in-editor targets, explorer
  sidebar toggle, focus/zen toggle; consume the sprint-014 composition/header model.
- Compact (mobile-class) switcher: on `isCompact`, replace the multi-pane layout with a single active
  pane + a switcher (tab list, new-target actions, no split); consume the sprint-014 mobile-switcher
  model.
- Bulk-close: closing the workspace/many tabs runs the sprint-014 bulk-close classification →
  confirmation dialog (counts local vs server-archiving tabs) → plan execution.

## Out of scope
- Panel body content (sprint-021/022). Explorer sidebar body (sprint-022/task-001).

## Acceptance criteria
- [ ] The header renders title + actions (scripts/open-in-editor/explorer/focus) wired to the model.
- [ ] On compact, the switcher shows one pane + tab list + new actions and hides splits.
- [ ] Bulk-close classifies tabs, confirms with correct wording, and executes the plan.

## Test / verification plan
- Tests: header action model; compact switcher entries/new-actions (reuse model); bulk-close
  classification + confirmation wording + plan (reuse `bulk-close.ts`).

## Notes
- Completes the workspace shell chrome; panel bodies arrive in sprints 021–022.
