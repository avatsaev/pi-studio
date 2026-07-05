# `@av-pi-studio/desktop` — AGENTS.md

Electron shell that bundles and supervises a Pi-Studio daemon alongside the app UI.

> **Status: placeholder — implementation planned for a later sprint.**
> The current source exports only a package identifier constant.

---

## Intended purpose

`desktop` is a **single-binary Electron application** that:

1. **Bundles the daemon** (`@av-pi-studio/server`) and starts it in-process (or as a supervised
   child process) on launch — no separate terminal needed.
2. **Hosts the app** (`@av-pi-studio/app`) in a BrowserWindow — the Expo web build or a
   dedicated Electron renderer.
3. **Manages the daemon lifecycle**: start on app open, graceful shutdown on app quit, restart on
   crash.
4. **Exposes OS integrations**: system tray icon, native file open dialogs, OS notifications,
   auto-update.

---

## Dependency graph

```
desktop  →  @av-pi-studio/app     (renderer / UI)
desktop  →  @av-pi-studio/server  (daemon, spawned/embedded in main process)
```

`desktop` is the **only package** that depends on both `app` and `server` simultaneously. This
is intentional — it is the integration point. No other package should import `desktop`.

---

## Planned architecture

### Main process (Electron main)

- Reads `$PI_STUDIO_HOME` / `PI_STUDIO_LISTEN` from environment or Electron app data path.
- Spawns (or directly starts) the daemon server on `127.0.0.1:<port>`.
- Writes the daemon address into an IPC channel / env var so the renderer knows where to connect.
- Listens for `before-quit` and sends SIGTERM / calls `shutdown()` on the daemon.
- Implements a system-tray menu: show/hide window, daemon status, quit.

### Renderer process

- Loads `@av-pi-studio/app` (web build).
- Connects to the local daemon at `ws://127.0.0.1:<port>` using `DaemonClient`.
- No relay needed for the local connection; the relay transport is still available for remote
  daemon connections initiated from within the app.

---

## Current source

```
src/
  index.ts    export const DESKTOP_PACKAGE = "@av-pi-studio/desktop"
```

---

## When implementing this sprint

1. Read `clean-room-scope/architecture/daemon-bootstrap.md` for daemon startup/shutdown sequencing.
2. The daemon can be embedded via `import { startDaemon } from "@av-pi-studio/server"` (the
   server package exposes a programmatic `index.ts` API) or spawned as a child process.
3. Use `electron-builder` (or `electron-forge`) for packaging; configure `asar` to bundle all
   workspace packages.
4. The renderer must connect to the daemon using `DaemonClient` — not by importing server code
   directly.
5. Do not expose Node APIs to the renderer via `contextBridge` beyond what is strictly necessary
   (follow Electron security best practices).

---

## Key invariants (for future implementation)

- **One daemon per app instance.** Prevent duplicate daemon processes (use the PID lock at
  `$PI_STUDIO_HOME/pi-studio.pid`).
- **Graceful shutdown.** On app quit, wait for the daemon to write its PID lock removal before
  the process exits.
- **Renderer isolation.** The renderer only talks to the daemon over WebSocket; it never calls
  server functions directly.
- **`desktop` is the only `server` + `app` consumer.** No other package depends on both.
