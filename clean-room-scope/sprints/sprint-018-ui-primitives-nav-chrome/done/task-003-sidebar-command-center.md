# Task 003 — Left sidebar, nav chrome & command center

- **Sprint:** sprint-018-ui-primitives-nav-chrome
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-002; sprint-013/task-004,005 (sidebar/command-center models), sprint-012/task-005 (shortcuts)

## Goal
Build the persistent navigation chrome: the collapsible left sidebar (hosts + nav + projects), the
command center (⌘K palette), the keyboard-shortcuts dialog, and the host-chooser modal — matching
Paseo's shell.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § left sidebar, § command center
- `clean-room-scope/features/keyboard-shortcuts.md`

## What to build
- `LeftSidebar`: host switcher, primary nav (Sessions/Schedules/Settings/New), projects list, collapse/
  expand with animation, compact overlay behavior; consume the sprint-013 sidebar view model.
- `CommandCenter`: a searchable command palette (open on the shortcut), grouped actions/results,
  keyboard navigation, execute → route/dispatch; consume the sprint-013 command-center model + the
  sprint-012 shortcut dispatcher/registry.
- `KeyboardShortcutsDialog` (list + per-action override editing via the overrides store) and a global
  shortcut dispatcher mount that routes key events to the registry.
- `HostChooserModal` / add-host entry points (UI only; pairing screen is sprint-019/task-001).

## Out of scope
- Screens the nav routes to (sprint-019). Workspace shell (sprint-020).

## Acceptance criteria
- [ ] The sidebar lists hosts + nav + projects, collapses/expands, and overlays on compact.
- [ ] Command center opens via shortcut, filters/executes actions, and is keyboard-navigable.
- [ ] The shortcuts dialog lists bindings and edits overrides (persisted); the dispatcher fires actions.

## Test / verification plan
- Tests: sidebar model→items rendering; command-center filter/execute (reuse model); shortcut
  dispatch + override persistence (reuse sprint-012 registry/overrides-store).

## Notes
- This completes the app shell chrome; sprint-019 screens render into the content outlet beside it.
