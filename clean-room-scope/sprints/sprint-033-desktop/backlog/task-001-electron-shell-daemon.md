# Task 001 — Electron shell + managed daemon supervisor

- **Sprint:** sprint-033-desktop
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** sprint-028 (full web app complete); sprint-004/task-005 (daemon bootstrap)

## Goal
Stand up the Electron main/preload shell that supervises a bundled daemon subprocess and loads the
web build of the app.

## Scope references
- `clean-room-scope/features/desktop-app.md` § Bridge capabilities, § Behavior (on app start), § Local
  vs. remote daemon mode
- `clean-room-scope/architecture/daemon-bootstrap.md`, `clean-room-scope/architecture/client-app-runtime.md` § Platform gating

## What to build
- `packages/desktop/src/`: Electron main + preload bridge.
- A persisted `DesktopDaemonMode` setting (`"embedded" | "remote-only"`, default `"embedded"`).
- On app start: `setupLoginShellEnv()` (inherit user shell PATH/env); when `desktopDaemonMode ==
  "embedded"`, ensure/start a managed daemon subprocess (`PI_STUDIO_HOME=~/.pi-studio`, port 6767) — if
  a daemon already owns 6767 (PID lock), connect to the existing one — and `createWindow()` loads the
  web app pointing at the local daemon; when `desktopDaemonMode == "remote-only"`, skip daemon spawn
  entirely and `createWindow()` loads the web app with no local host (it behaves like the mobile/web
  client and falls through to a saved remote host or to `/welcome`).
- A bridge method to read/switch `desktopDaemonMode` at runtime: switching to `"embedded"` starts the
  local daemon immediately (no relaunch); switching to `"remote-only"` while the embedded host is the
  only saved host surfaces a confirmation first (renderer-side; see sprint-013/task-002).
- Renderer detects Electron via `getIsElectron()`. The renderer is the **Vite-built React DOM app**
  (`packages/app`, `VITE_TARGET=electron` build); `createWindow()` loads that bundle. Electron-only
  modules (`*.electron.ts(x)`) are loaded via guarded dynamic `import()` (see
  architecture/client-app-runtime § Platform rules).

## Out of scope
- Multi-window/land-on (task-002). Native integrations (task-003). Browser panes (task-004).

## Acceptance criteria
- [ ] In the default `embedded` mode, launching the app starts (or connects to) a managed daemon and
      loads the web app.
- [ ] A daemon already running on 6767 is connected to (PID lock prevents a second daemon).
- [ ] In `remote-only` mode, no daemon subprocess is spawned and the app behaves like the mobile/web
      client against saved remote hosts.
- [ ] Switching `desktopDaemonMode` at runtime starts/stops local supervision without requiring a
      relaunch.
- [ ] `getIsElectron()` / `.electron.*` modules select desktop-only implementations.
- [ ] Login shell env is inherited so the daemon/agents see the user's PATH.

## Test / verification plan
- Tests: `npx vitest run packages/desktop/.../daemon-supervisor.test.ts` — spawn/connect-existing
  branching (mock spawn).
- Manual: launch the Electron app → window loads and connects to the local daemon.

## Notes
- Keep daemon supervision idempotent against the PID lock.
- Consume the build-time brand config (sprint-012/task-006) for `app.setName`, window title, and the
  packaged app icon (`electron-builder`); default = Pi-Studio when unset. See
  `clean-room-scope/features/desktop-app.md` § Branding and
  `clean-room-scope/features/white-label-branding.md`.
