# Desktop App (Electron) — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [../architecture/daemon-bootstrap.md](../architecture/daemon-bootstrap.md),
> [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md),
> [../architecture/ssh-gateway-connections.md](../architecture/ssh-gateway-connections.md),
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
| SSH gateway | Electron-main SSH tunnel creation, host-key storage, secret storage, tunnel lifecycle |

Renderer detects Electron via `getIsElectron()`; Electron-only modules use `.electron.ts(x)` Metro
extensions (Electron is still the Metro `web` platform, selected via `PI_STUDIO_WEB_PLATFORM=electron`).

### Local vs. remote daemon mode
The desktop app is a full daemon **client** first; running its own daemon locally is one mode among
several a saved host can be, not a hidden implementation detail. This keeps "work entirely on this
machine, isolated from any network" and "drive one or more daemons running elsewhere" as equally
first-class, user-visible choices — the desktop shell never *requires* a remote connection, and adding
remote hosts (direct/relay/SSH gateway, see [../architecture/ssh-gateway-connections.md](../architecture/ssh-gateway-connections.md))
never disables or replaces the local one.
```ts
type DesktopDaemonMode = "embedded" | "remote-only"; // persisted desktop app setting, default "embedded"
```
- **`embedded` (default):** on every app start the shell ensures/starts its own managed daemon subprocess
  (as in Behavior & Algorithms below) and it appears in the host list as a distinguished **local** host
  (e.g. "This Mac") — a `HostProfile` the app itself supervises, distinct from a `DirectHostProfile`
  pointing at some other directly-reachable daemon it does not manage. Nothing about this machine's
  agent state, git worktrees, or terminals ever leaves it unless the user separately adds a remote host.
- **`remote-only`:** the shell never spawns a daemon subprocess; it behaves exactly like the mobile/web
  client, connecting only to saved remote `HostProfile`s (direct / relay / SSH gateway). Useful for a
  machine meant to act purely as a control terminal for daemons running elsewhere, with no local
  workspace state at all.
- **Switching modes:** a Settings → Daemon (desktop-only) toggle changes `desktopDaemonMode`; switching
  to `remote-only` while the embedded daemon is the *only* saved host warns the user first ("you'll see
  Welcome next launch until you add a host"). Switching back to `embedded` — from Settings, or from
  Welcome's desktop-only **"Use this computer"** action (see
  [app-navigation-screens.md](app-navigation-screens.md) § Onboarding & pairing) — starts the local
  daemon immediately (no relaunch required) and does not require or affect any already-saved remote
  hosts; both kinds of host coexist in the same host list.

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
    if desktopDaemonMode == "embedded":    # default; see § Local vs. remote daemon mode
        ensure/start managed daemon subprocess (PI_STUDIO_HOME = ~/.pi-studio, port 6767)
        createWindow() → load web app pointing at the local daemon
    else:                                   # "remote-only"
        createWindow() → load web app with no local daemon; boot resolver falls through to
                          a saved remote host, or to /welcome if none is online yet
    register menus, auto-updater, notifications, browser-webview subsystem
    expose desktop-only SSH gateway bridge for remote daemon profiles

on second-instance / ⌘⇧N / "open in new window":
    createWindow(); set its pending open-project; window opens normally and lands on the project
```

### Permissions
Settings → Permissions (desktop-only) surfaces OS-level grant state for two capabilities Pi-Studio may
need on the desktop shell:
```ts
type DesktopPermissionKind = "notifications" | "microphone";
type DesktopPermissionState = "granted" | "denied" | "prompt" | "not-granted" | "unavailable" | "unknown";
```
- **Notifications:** read via the OS notification permission API; `denied`/`prompt` show a
  human-readable detail string and a re-request or "open OS settings" action as appropriate.
- **Microphone:** probed via a throwaway `getUserMedia({ audio: true })` call (immediately stopping the
  resulting track) combined with the Permissions API's `query({ name: "microphone" })` where available;
  falls back to `unavailable` in environments lacking both. Needed for dictation/realtime voice (see
  [composer-ui.md](composer-ui.md)).
- A permission snapshot is `{ checkedAt, notifications, microphone }`, refreshed on demand (e.g. when
  the Permissions settings section is opened) rather than polled continuously.

### Update callout
An auto-update banner surfaced wherever the app chrome renders callouts (see
[ui-components.md](../features/ui-components.md) § Feedback — sidebar callout slot), driven by a small
state machine over the updater's status:
```ts
type DesktopAppUpdateCheckResult = {
  hasUpdate: boolean; readyToInstall: boolean;
  currentVersion: string | null; latestVersion: string | null;
  body: string | null; date: string | null; errorMessage: string | null;
};
type DesktopReleaseChannel = "stable" | "beta";
type DesktopAppUpdateCheckIntent = "automatic" | "manual";
```
- **Callout states:** `available` (an update is downloaded/ready — shows the target version + a
  Changelog action + an Install action), `installing` (install in progress, actions disabled),
  `error` (shows the error message + a Retry action). No callout renders outside these three states
  (including while merely checking).
- **Dismissal:** keyed per `status:version` (`dismissalKey`) so dismissing one available-update callout
  doesn't suppress a *later*, different version's callout.
- **Channels:** `stable`/`beta` release channel selection (Settings → Daemon or About, desktop-only);
  gating is channel-based, not a percentage staged-rollout — there is no partial-rollout percentage
  logic in the client. Checks can be `automatic` (periodic/on-launch) or `manual` (user-triggered
  "Check for updates").
- **Apple Silicon note:** the runtime-info probe reports `runningUnderARM64Translation`; a distinct
  "Rosetta" callout can prompt an ARM64-native reinstall when running translated.

### Known v1 limitations (documented)
- **Window-state v1:** only the *first* window of a session restores/persists geometry
  (size/position/maximized). Other windows open at default size, OS-cascaded, and don't persist —
  avoids all windows stacking on the same restored bounds. Lifting this needs per-window state keys.
- **Browser panes are process-global, not per-window:** the active-browser id and the webview
  registration queue are global. With browser panes open in two windows, a menu Reload can target
  the other window's webview, and near-simultaneous attach can register under the wrong browser id.

## Data & Persistence
- Reuses the daemon's `~/.pi-studio` state. `desktopDaemonMode` is a desktop app-local setting (default
  `"embedded"`), independent of the saved host list. Window geometry persisted in an app-local
  window-state store (first window only, v1). Pending open-project is per-`webContents`, transient. SSH
  gateway known hosts and secret references are desktop app state; raw SSH secrets are kept only in
  OS-backed secret storage.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Daemon already running on 6767 | Connect to existing (PID lock prevents a second daemon) |
| `desktopDaemonMode == "remote-only"` and no remote host saved/online yet | Boot resolver falls through to `/welcome`, which offers "Use this computer" (switch back to `embedded`) alongside Direct connection/Paste pairing link |
| User switches `remote-only → embedded` while a window is open | Local daemon starts immediately; no relaunch required |
| User switches `embedded → remote-only` with the embedded host as the only saved host | Confirmation prompt warns Welcome will show next launch until a host is added |
| Update available | Callout shows target version + Changelog/Install; installing disables actions; error shows Retry |
| Update check fails | Error callout with the failure message + Retry (does not block the app) |
| Notification/microphone permission denied | Settings → Permissions shows `denied` + detail text + a re-request/open-OS-settings action |
| Running under Rosetta (Apple Silicon) | A distinct callout offers an ARM64-native reinstall |
| Multiple windows + browser panes | Known cross-window webview targeting bug (v1) |
| Second instance launched | Routes to `createWindow` + pending project instead of a new process |

## Dependencies
- Internal: desktop main/preload, daemon supervisor, `desktopDaemonMode` setting, web app build,
  open-project routing, pending-open-project store, i18n (callout/permission copy).
- External: Electron, `electron-updater` (auto-update), `electron-log` (logging), `electron-builder`
  (packaging), OS notification/dock/permission APIs.

## Acceptance Criteria
- [ ] Launching the app in the default `embedded` mode starts (or connects to) a managed daemon and
      loads the web app; a saved remote host (direct/relay/SSH gateway) works the same as on mobile/web
      and coexists with the local host in the same host list.
- [ ] Switching to `remote-only` stops the app from spawning its own daemon on the next start, and
      switching back to `embedded` (from Settings or from Welcome's "Use this computer") starts the
      local daemon without a relaunch.
- [ ] ⌘⇧N opens a new window with the full sidebar.
- [ ] A second app launch lands the new window on the requested project (like `pi-studio <path>`).
- [ ] Only the first window restores saved geometry (v1).
- [ ] `getIsElectron()`/`.electron.*` modules select desktop-only implementations.
- [ ] The update callout renders only in `available`/`installing`/`error` states, is dismissable per
      `status:version`, and re-appears for a genuinely new version after a prior dismissal.
- [ ] Settings → Permissions reports accurate notification/microphone grant state and can trigger a
      re-request or deep-link to OS settings.

## TODO(verify)
- [ ] Whether any server-side staged/percentage rollout exists behind the `stable`/`beta` channels (the
      client itself only channel-selects; no percentage gating logic was found client-side).
- [ ] Editor-target detection and the full preload bridge API surface.
- [ ] Exact Settings → Daemon UI copy/placement for the `DesktopDaemonMode` toggle (this is a
      Pi-Studio product decision layered on top of the reference app's always-on local daemon, not a
      Paseo parity item — no upstream behavior to check against).
