# Task 004 — Empty-draft seeding, route gating, mobile tab switcher

- **Sprint:** sprint-015-workspace-shell
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-003

## Goal
Implement empty-draft seeding, workspace route gating, and the compact/mobile tab switcher.

## Scope references
- `clean-room-scope/features/workspace-ui.md` § Empty-draft seeding, § Route gating, § Mobile tab
  switcher

## What to build
- Empty-draft seeding: when a workspace opens with no tabs (or a pane is emptied), seed a draft tab so the
  composer is always present; respect the `?open=` route intent (focus/open a specific target on entry).
- Route gating for `/h/[serverId]/workspace/[workspaceId]`: validate the workspace belongs to the active
  host + is known; unknown/foreign → redirect (per the navigation rules); show the splash until tabs
  hydrate.
- Mobile/compact tab switcher: a single visible tab + a switcher surface (list of open tabs with
  label/icon/status-dot + close) replacing the desktop multi-pane strip; new-tab actions; no splits.

## Out of scope
- Tab model (task-001), splits/LRU (task-002), header composition (task-003). Panel internals
  (sprints 016–017).

## Acceptance criteria
- [ ] Opening an empty workspace always shows a composer (seeded draft); `?open=` focuses the requested
      target.
- [ ] A foreign/unknown workspace id redirects; the splash shows until tabs hydrate.
- [ ] On compact, exactly one tab is visible with a working switcher + new-tab actions and no split UI.

## Test / verification plan
- Tests: seeding on empty workspace / emptied pane; `?open=` intent resolution; route-gate redirect
  decision; switcher entry building.

## Notes
- Exact `?open=` intent vocabulary is TODO(verify).
