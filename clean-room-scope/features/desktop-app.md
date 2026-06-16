# Desktop App (Electron) — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [../architecture/daemon-bootstrap.md](../architecture/daemon-bootstrap.md),
> [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md),
> [projects-workspaces.md](projects-workspaces.md)

## Purpose

The desktop app is an Electron wrapper (macOS, Linux, Windows) around the web build of the Expo app.
It can spawn and supervise its own daemon subprocess, provides native integrations (file dialogs,
menus, titlebar, dock badges, auto-update, in-app browser webviews), and supports multiple windows.

## Public Contract

### Bridge (preload → renderer) capabilities
| Area | Purpose |
|------|---------|
| Daemon management | Start/stop/supervise a bundled daemon subprocess |
| File dialogs | Native open/save dialogs |
| Titlebar | Drag region, window controls |
| Menus | Application/context menus, Reload, New Window (⌘⇧N) |
| App updates | Auto-updater + rollout gating |
| Notifications | Native notifications, dock/taskbar badges |
| Browser panes | Embedded `<webview>` in-app browser |
| Open-in-editor | Launch external editors on targets |
| Pending open-project | Per-`webContents` pending project path for "land on a project" |

Renderer detects Electron via `getIsElectron()`; Electron-only modules use `.electron.ts(x)` Metro
extensions (Electron is still the Metro `web` platform, selected via `PI_STUDIO_WEB_PLATFORM=electron`).

### Multi-window model (hybrid land-on)
- `createWindow()` is reusable: ⌘⇧N / File→New Window, relaunch (`second-instance`), and sidebar
  "Open in new window" each open a fresh `BrowserWindow`.
- Every window shows the full sidebar — no per-window project ownership/filtering.
- "Land on a project" is delivered per-`webContents` via a `PendingOpenProjectStore`: each window
  pulls its pending project path on mount (`pi-studio:get-pending-open-project`) and runs the normal
  open-project flow (identical to a CLI `pi-studio <path>` launch).

## Behavior & Algorithms

```
on app start:
    setupLoginShellEnv()                  # inherit user's shell PATH/env
    ensure/start managed daemon subprocess (PI_STUDIO_HOME = ~/.pi-studio, port 6767)
    createWindow() → load web app pointing at the local daemon
    register menus, auto-updater, notifications, browser-webview subsystem

on second-instance / ⌘⇧N / "open in new window":
    createWindow(); set its pending open-project; window opens normally and lands on the project
```

### Known v1 limitations (documented)
- **Window-state v1:** only the *first* window of a session restores/persists geometry
  (size/position/maximized). Other windows open at default size, OS-cascaded, and don't persist —
  avoids all windows stacking on the same restored bounds. Lifting this needs per-window state keys.
- **Browser panes are process-global, not per-window:** the active-browser id and the webview
  registration queue are global. With browser panes open in two windows, a menu Reload can target
  the other window's webview, and near-simultaneous attach can register under the wrong browser id.

## Data & Persistence
- Reuses the daemon's `~/.pi-studio` state. Window geometry persisted in an app-local window-state store
  (first window only, v1). Pending open-project is per-`webContents`, transient.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Daemon already running on 6767 | Connect to existing (PID lock prevents a second daemon) |
| Update available | Auto-updater downloads per rollout gating; prompts/install per policy |
| Multiple windows + browser panes | Known cross-window webview targeting bug (v1) |
| Second instance launched | Routes to `createWindow` + pending project instead of a new process |

## Dependencies
- Internal: desktop main/preload, daemon supervisor, web app build, open-project routing,
  pending-open-project store.
- External: Electron, electron auto-updater, OS notification/dock APIs.

## Acceptance Criteria
- [ ] Launching the app starts (or connects to) a managed daemon and loads the web app.
- [ ] ⌘⇧N opens a new window with the full sidebar.
- [ ] A second app launch lands the new window on the requested project (like `pi-studio <path>`).
- [ ] Only the first window restores saved geometry (v1).
- [ ] `getIsElectron()`/`.electron.*` modules select desktop-only implementations.

## TODO(verify)
- [ ] Auto-update rollout gating rules.
- [ ] Editor-target detection and the full preload bridge API surface.
