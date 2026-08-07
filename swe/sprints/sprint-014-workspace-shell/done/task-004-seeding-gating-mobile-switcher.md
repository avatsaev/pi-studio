# Task 004 — Empty-draft seeding, pinned quick-launch targets, route gating, mobile tab switcher

- **Sprint:** sprint-014-workspace-shell
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-003

## Goal
Implement empty-draft seeding, pinned quick-launch targets, workspace route gating, and the
compact/mobile tab switcher.

## Scope references
- `clean-room-scope/features/workspace-ui.md` § Empty-draft seeding, § Pinned quick-launch targets,
  § Route gating, § Mobile tab switcher

## What to build
- Empty-draft seeding: when a workspace opens with no tabs (or a pane is emptied), seed a draft tab so the
  composer is always present; respect the `?open=` route intent (focus/open a specific target on entry).
- Pinned quick-launch targets: the `pinned-tab-targets` client store (`draft | terminal | browser |
  profile:<id>`, default `terminal`+`browser` pinned, versioned migration), a toggle helper keyed by
  target, and one-tap quick-launch buttons rendered alongside the empty-workspace seed and in the mobile
  new-tab picker; a "Pin"/"Unpin" toggle on each pinnable "new" menu item.
- Route gating for `/h/[serverId]/workspace/[workspaceId]`: validate the workspace belongs to the active
  host + is known; unknown/foreign → redirect (per the navigation rules); show the splash until tabs
  hydrate.
- Mobile/compact tab switcher: a single visible tab + a switcher surface (list of open tabs with
  label/icon/status-dot + close) replacing the desktop multi-pane strip; new-tab actions; no splits.

## Out of scope
- Tab model (task-001), splits/LRU (task-002), header composition (task-003). Panel internals
  (sprints 016–017). Saved create-agent-preferences profiles themselves (composer/sprint-015) — this
  task only consumes a `profile.profileId` reference.

## Acceptance criteria
- [ ] Opening an empty workspace always shows a composer (seeded draft); `?open=` focuses the requested
      target.
- [ ] Pinned targets (terminal + browser by default) render one-tap quick-launch buttons and can be
      toggled from the relevant "new" menus; the pinned set persists across reloads.
- [ ] A foreign/unknown workspace id redirects; the splash shows until tabs hydrate.
- [ ] On compact, exactly one tab is visible with a working switcher + new-tab actions and no split UI.

## Test / verification plan
- Tests: seeding on empty workspace / emptied pane; `?open=` intent resolution; pinned-target toggle +
  persistence + migration; route-gate redirect decision; switcher entry building.

## Notes
- Exact `?open=` intent vocabulary is TODO(verify).
