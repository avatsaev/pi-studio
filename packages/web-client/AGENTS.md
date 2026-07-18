# `@av-pi-studio/web-client` — AGENTS.md

Production React web client for Pi-Studio. Re-implements the `poc/chat.html` proof of concept as a
modular, typed, performant app. Ships as both a browser app and an Electron renderer.

> **Status: scaffold.** The skeleton (build, providers, theme system, design-system primitives) is in
> place. Features are implemented per the phased plan in the repo-root `POC_TO_APP_PLAN_UI.md`.

---

## Purpose

`web-client` is the **desktop/browser UI** for driving the Pi-Studio daemon. It connects to a daemon
over a single WebSocket via `@av-pi-studio/client` (never a raw socket) and renders chat sessions,
agent-stream timelines, tool calls, terminals, a file/diff viewer, and git status.

For the full feature inventory, target stack rationale, subsystem migration mapping, state
architecture, performance strategy, and phased delivery, read **`POC_TO_APP_PLAN_UI.md`** at the repo
root — it is the source of truth for this package.

---

## Dependency graph

```
web-client  →  @av-pi-studio/client   (DaemonClient + PiStudioClient — all networking)
web-client  →  @av-pi-studio/protocol (wire types + binary codecs)
```

Must **not** import `@av-pi-studio/server` or `@av-pi-studio/cli`.
The Electron shell (`@av-pi-studio/desktop`) consumes this package's web build as its renderer and
owns daemon supervision — this package stays a pure renderer.

---

## Stack

React 19 · TypeScript 5 (ESM) · Vite 6 · Zustand (client state) · TanStack Query + Virtual ·
Radix UI + floating-ui (overlays) · dnd-kit · Framer Motion · lucide-react · react-markdown +
remark-gfm · Shiki · xterm.js · react-router · CSS Modules. Tests: Vitest + Testing Library.

---

## Source layout

```
index.html                 Vite entry (mounts #root)
vite.config.ts             web + electron build targets, manualChunks, /daemon-ws dev proxy
tsconfig.json              app config (DOM libs, react-jsx, noEmit)
tsconfig.node.json         config for vite.config.ts
src/
  main.tsx                 createRoot → <AppProviders><App/>
  app.tsx                  root component (skeleton)
  global.css               resets + scrollbar; colors come from theme --pi-* vars
  css-modules.d.ts         ambient CSS-module typings
  providers/               AppProviders, kv-store (localStorage-backed KeyValueStore)
  theme/                   theme tokens, palette, appearance-store, css-bridge, ThemeBoundary
  brand/                   brand config + accent injection (theme dependency)
  ui/                      framework-free design-system logic (button/select/status/… tokens)
  platform/                breakpoints (window-chrome metrics)
  components/primitives/   React design-system components (Button, Select, Surface, …)
  lib/connection/          query-client (TanStack Query)
  stores/                  Zustand slices (empty — added per phase)
  timeline/                streaming/render model (empty — added per phase)
  features/                feature-scoped React views (empty — added per phase)
  components/              reusable primitives beyond the design system (empty)
  hooks/  routes/  test/   (empty — added per phase)
```

The theme system + `components/primitives/` design system were ported from the prior web app and are
the canonical UI foundation. Color/type tokens are injected at runtime as `--pi-*` CSS variables by
`theme/css-bridge.ts`, applied before first paint by `ThemeBoundary` (wired in `AppProviders`).

---

## Commands

```bash
npm run dev -w @av-pi-studio/web-client            # Vite dev server (WS proxy to daemon)
npm run typecheck -w @av-pi-studio/web-client      # tsc --noEmit
npm run build:web -w @av-pi-studio/web-client      # browser build (absolute base)
npm run build:electron -w @av-pi-studio/web-client # Electron renderer build (relative base)
```

Dev-server WS proxy env: `PI_STUDIO_DAEMON_HOST` / `PI_STUDIO_DAEMON_PORT` (default `127.0.0.1:6767`),
dev host/port via `WEB_CLIENT_DEV_HOST` / `WEB_CLIENT_DEV_PORT` (default `0.0.0.0:5173`).

---

## Invariants

- **No raw WebSockets.** All daemon traffic goes through `@av-pi-studio/client`.
- **No Node-only APIs** in renderer code (runs in browser + Electron renderer).
- **Connection URL is injectable** (browser: toolbar/URL params; Electron: `contextBridge`).
- **Relative-base safe** — the Electron build loads from `file://`; never assume absolute asset paths.
- **Protocol append-only** — ignore unknown session-message `type`s gracefully.
