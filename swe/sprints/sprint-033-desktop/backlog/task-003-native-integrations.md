# Task 003 — Native integrations (dialogs, menus, titlebar, notifications, auto-update)

- **Sprint:** sprint-033-desktop
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Implement the desktop native integrations exposed through the preload bridge.

## Scope references
- `swe/features/desktop-app.md` § Bridge capabilities, § Error Handling

## What to build
- Preload→renderer bridge surfaces: native file open/save dialogs; titlebar (drag region, window
  controls); application/context menus (Reload, New Window ⌘⇧N); notifications + dock/taskbar badges;
  open-in-editor (launch external editors on targets); auto-updater + rollout gating.
- Auto-updater downloads per rollout gating and prompts/installs per policy.

## Out of scope
- Browser panes / webviews (task-004). Multi-window (task-002).

## Acceptance criteria
- [ ] Native open/save dialogs return chosen paths to the renderer.
- [ ] Menus expose Reload and New Window (⌘⇧N); titlebar drag/controls work.
- [ ] Native notifications fire and dock/taskbar badges update.
- [ ] The auto-updater checks/downloads per rollout gating.
- [ ] Open-in-editor launches the configured external editor on a target.

## Test / verification plan
- Tests: `npx vitest run packages/desktop/.../bridge.test.ts` — bridge method contracts (mock Electron
  APIs).
- Manual: trigger a save dialog + a native notification.

## Notes
- Auto-update rollout gating rules + full preload bridge API surface are TODO(verify).
- The local-vs-remote daemon mode toggle (`DesktopDaemonMode`, Settings → Daemon) is built in task-001,
  not here — see `swe/features/desktop-app.md` § Local vs. remote daemon mode. This task
  only surfaces existing native OS integrations (dialogs/menus/notifications/dock/auto-update); it does
  not change how a daemon is selected/started.
- Product-identity strings (About panel, notification app name, dock/taskbar label, updater feed naming)
  resolve from the build-time brand config (sprint-012/task-006); default = Pi-Studio. See
  `swe/features/desktop-app.md` § Branding.
