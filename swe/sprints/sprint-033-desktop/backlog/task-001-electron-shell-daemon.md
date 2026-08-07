# Task 001 — Electron shell + managed daemon supervisor

- **Sprint:** sprint-033-desktop
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** web-client (React+Vite DOM app, `build:web`/`build:electron` targets already
  wired); sprint-004/task-005 (daemon bootstrap)

## Goal
Stand up the Electron main/preload shell that supervises a bundled daemon subprocess and loads the
web build of the app.

## Scope references
- `swe/features/desktop-app.md` § Bridge capabilities, § Behavior (on app start), § Local
  vs. remote daemon mode
- `swe/architecture/daemon-bootstrap.md`, `swe/architecture/client-app-runtime.md` § Platform gating

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
- Renderer detects Electron via `getIsElectron()` — **new work**: `web-client` has no Electron
  detection or platform-gating module yet, so this task adds it (e.g. `src/platform/electron.ts`),
  reads `import.meta.env.VITE_TARGET === "electron"` and/or the preload-injected marker, and is
  cached per the existing `build:electron` Vite target. The renderer itself is the **Vite-built
  React DOM app** (`packages/web-client`, `VITE_TARGET=electron` build via its existing
  `build:electron` script); `createWindow()` loads that bundle
  (`packages/web-client/dist/electron/index.html`). Electron-only modules (`*.electron.ts(x)`) are
  loaded via guarded dynamic `import()` (see architecture/client-app-runtime § Platform rules).
- `connection-store.ts`'s `connect()` currently only takes a URL typed by the user in the toolbar —
  **new work**: it must also accept a daemon URL injected via `window.piStudio.daemonUrl` (set by
  the preload bridge) so Electron can supply the local daemon address without the user typing it;
  the browser path (toolbar input / URL params) is unchanged and takes precedence only when no
  injected URL is present.

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
  `swe/features/desktop-app.md` § Branding and
  `swe/features/white-label-branding.md`.
