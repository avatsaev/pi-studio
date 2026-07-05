# Task 002 — Multi-window model + land-on-project

- **Sprint:** sprint-018-desktop
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** task-001; task-002 (sprint-008, open-project)

## Goal
Implement the reusable window factory and the per-`webContents` pending-open-project "land on a
project" flow.

## Scope references
- `clean-room-scope/features/desktop-app.md` § Multi-window model (hybrid land-on), § Behavior, § Known v1 limitations

## What to build
- `createWindow()` reusable for ⌘⇧N / File→New Window, relaunch (`second-instance`), and sidebar
  "Open in new window"; every window shows the full sidebar (no per-window project ownership).
- `PendingOpenProjectStore` (per-`webContents`): a window pulls its pending project path on mount
  (`pi-studio:get-pending-open-project`) and runs the normal open-project flow (identical to a CLI
  `pi-studio <path>` launch).
- Window-state v1: only the FIRST window of a session restores/persists geometry; others open at
  default size, OS-cascaded, non-persistent.

## Out of scope
- Per-window window-state lifting (documented v1 limitation). Native menus detail (task-003).

## Acceptance criteria
- [ ] ⌘⇧N opens a new window with the full sidebar.
- [ ] A second app launch lands the new window on the requested project (like `pi-studio <path>`).
- [ ] Only the first window restores saved geometry (v1).
- [ ] Sidebar "Open in new window" opens a fresh window and lands on the project.

## Test / verification plan
- Tests: `npx vitest run packages/desktop/.../pending-open-project.test.ts` — per-webContents pending
  path pull + land-on flow (mock).
- Manual: relaunch with a project path → new window lands on it.

## Notes
- Window-state persistence beyond the first window is a known v1 limitation (TODO(verify) before lifting).
