# `@av-pi-studio/web-client` — AGENTS.md

Production React web client for Pi-Studio. Re-implements the `poc/chat.html` proof of concept as a
modular, typed, performant app.

> **Status: implemented.** The 3-column workspace shell, connection layer, sessions sidebar,
> chat/timeline, composer, file explorer + viewers, git changes panel, terminals, and the design
> system are all built and wired. Two Vite build targets (`build:web` / `build:electron`) exist, but
> the **Electron-specific runtime code does not exist yet** — no `getIsElectron()`, no injected
> daemon URL, no `contextBridge` consumer. That is `clean-room-scope/sprints/sprint-033-desktop`
> scope (task-001), not shipped. See `POC_TO_APP_PLAN_UI.md` at the repo root for the original phased
> plan this was built against.

---

## Purpose

`web-client` is the **desktop/browser UI** for driving the Pi-Studio daemon. It connects to a daemon
over a single WebSocket via `@av-pi-studio/client` (never a raw socket) and renders chat sessions,
agent-stream timelines, tool calls, terminals, a file/diff viewer, and git status.

For the original feature inventory, target stack rationale, subsystem migration mapping, and phased
delivery plan, see **`POC_TO_APP_PLAN_UI.md`** at the repo root — treat it as historical planning
context, not a live status document; this file describes what's actually built.

---

## Dependency graph

```
web-client  →  @av-pi-studio/client   (DaemonClient + PiStudioClient — all networking)
web-client  →  @av-pi-studio/protocol (wire types + binary codecs)
```

Must **not** import `@av-pi-studio/server` or `@av-pi-studio/cli`.
The Electron shell (`@av-pi-studio/desktop`, currently a placeholder — see its own `AGENTS.md`) is
meant to consume this package's `build:electron` output as its renderer and own daemon supervision;
this package stays a pure renderer and must not gain Node-only dependencies.

---

## Stack

React 19 · TypeScript 5 (ESM) · Vite 6 · Zustand (client state) · TanStack Query + Virtual ·
Radix UI (dialog/dropdown-menu/popover/tooltip) + floating-ui (overlays) · dnd-kit ·
Framer Motion · lucide-react · react-markdown + remark-gfm · Shiki (syntax highlighting) ·
CodeMirror 6 (`@codemirror/*`, `@uiw/react-codemirror` + GitHub theme — code file viewer) ·
`@xterm/xterm` + `@xterm/addon-fit` (terminals) · zod (brand-config validation) · CSS Modules ·
clsx. Tests: Vitest.

`react-router` is **not** currently used — the app has a single hardcoded root page
(`routes/WorkspacePage.tsx`), no client-side routing yet.

---

## Source layout

```
index.html                 Vite entry (mounts #root)
vite.config.ts             web + electron build targets, manualChunks, /daemon-ws dev proxy
tsconfig.json              app config (DOM libs, react-jsx, noEmit)
tsconfig.node.json         config for vite.config.ts
src/
  main.tsx                 createRoot → <StrictMode><App/></StrictMode>
  app.tsx                  root component: AppProviders → Boot (connection/session/shortcuts) → WorkspacePage
  global.css               resets + scrollbar; colors come from theme --pi-* vars
  css-modules.d.ts          ambient CSS-module typings
  vite-env.d.ts             ambient `__APP_VERSION__` typing (vite.config.ts `define` — own
                             package.json version, shown in Toolbar.tsx after the brand title)
  providers/               AppProviders (ThemeBoundary + QueryClientProvider), kv-store (localStorage-backed KeyValueStore)
  theme/                   tokens, palette, color-utils, variants, appearance-store, css-bridge, theme.ts, ThemeBoundary
  brand/                   brand config (zod-validated), brand-logo, theme-injection
  ui/                      framework-free design-system logic (button/select/status/toast/shortcut/avatar tokens)
  platform/                breakpoints (window-chrome metrics)
  components/primitives/   36 React design-system components (Button, Select, Dialog, Surface,
                            TextInput, Switch, Checkbox, Avatar, ScrollArea, ResizeHandle,
                            StatusBadge/Dot, Shortcut, Spinner, ScreenTitle, Divider, Icon, …)
  lib/connection/          connection-store (Zustand + DaemonClient/PiStudioClient; also handles
                           relay-transport pairing-link connections), resolve-connect-target
                           (pure routing: plain address vs. pairing link, direct vs. relay + tests),
                           normalize-url (accepts ws/wss/http/https/bare-host, maps http→ws /
                           https→wss), query-client (TanStack Query), rpc-keys, files-changed
                           (cache-invalidation signaling)
  lib/protocol/            events.ts (protocol event helpers)
  stores/                  Zustand slices: ui-store, tab-store, session-store, git-store,
                           explorer-store (+ test)
  timeline/                streaming/render model: reducer, row-model, tool-mapping, markdown,
                           highlight (+ tests)
  hooks/                   use-connection (boot), use-session-restore, use-terminal-restore
                           (one-shot reopen of every daemon-side terminal as a tab on connect —
                           the safety net for terminals that outlive their tab, e.g. a daemon
                           restart or a terminal created outside this UI), use-shortcuts,
                           use-explorer, use-explorer-tree (one query per expanded tree directory,
                           feeds FileExplorer's flattened row list), use-file-read/-diff/-download,
                           use-file-transfer (upload + save-to-disk actions, shared
                           FileTransferClient via file-transfer-instance), use-checkout-status,
                           use-agent-stream (+ agent-stream-events), use-home-dir
  features/
    connection/            Toolbar, ConnectionStatus
    sessions/               SessionList, SessionItem, SessionContextMenu, WorkspaceGroupHeader,
                            open-workspace, status-map, workspace-grouping
    workspace/              TabStrip (tabs + trailing "+" menu: New chat / New terminal, scoped
                            to the active workspace — GitHub issue #8), TabPanelHost, panel-registry
    workspace-picker/       OpenWorkspaceDialog (directory browser)
    chat/                   ChatPanel, Timeline, Composer, Attachments, rows/ (Assistant/User/
                            System/Error/Reasoning rows, ToolCard)
    files/                  FilePanel, FileExplorer (tree view: lazy per-directory expansion
                            tracked in explorer-store + fetched via use-explorer-tree, rows
                            flattened by file-tree.ts and rendered through
                            @tanstack/react-virtual; upload button/drag-and-drop resolved to the
                            drop-target directory; per-row "⋮" context-menu trigger), TreeNode
                            (presentational row: chevron/icon/name + actions button),
                            FileContextMenu (download/delete), RightSidebar, DiffView, CodeView,
                            MarkdownFileViewer, ImageViewer, VideoViewer, BinaryFallbackViewer,
                            TextViewer, viewer-registry
    git/                    ChangesPanel
    terminal/               TerminalPanel (one xterm instance per open terminal tab; opening a
                            tab whose `data.slot` is already known — e.g. from
                            `use-terminal-restore.ts` — subscribes to the existing PTY instead of
                            spawning a new one). No dedicated "Terminals" management view —
                            orphaned terminals reopen automatically as tabs on connect.
  routes/                  WorkspacePage (the 3-column shell: sidebar-left / center / sidebar-right)
  components/              (reserved for non-design-system reusable components; currently empty)
  test/                    (reserved for shared test utilities; currently empty)
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
npm run build:electron -w @av-pi-studio/web-client # Electron renderer build (relative base) —
                                                    # produces a bundle; no Electron-only runtime
                                                    # code consumes it yet (see Status above)
```

Dev-server WS proxy env: `PI_STUDIO_DAEMON_HOST` / `PI_STUDIO_DAEMON_PORT` (default `127.0.0.1:6767`),
dev host/port via `WEB_CLIENT_DEV_HOST` / `WEB_CLIENT_DEV_PORT` (default `0.0.0.0:5173`).

Docker: `docker/web-client.Dockerfile` builds the `build:web` output into an `nginx:alpine` static
image (SPA fallback + optional same-origin `/daemon-ws` proxy set by `PI_STUDIO_DAEMON_UPSTREAM`);
`docker/docker-compose.yml` serves it on `:8080` alongside the daemon/relay. The daemon URL is
entered at runtime, never baked into the image.

---

## Invariants

- **No raw WebSockets.** All daemon traffic goes through `@av-pi-studio/client`.
- **No Node-only APIs** in renderer code (must run in browser + Electron renderer).
- **Relative-base safe** — the Electron build loads from `file://`; never assume absolute asset paths.
- **Protocol append-only** — ignore unknown session-message `type`s gracefully.
- **Connection input is toolbar/URL-param, either a direct address or a pairing link** — the same
  `ui-store.ts` host field (seeded from `?host=&password=&cwd=&connect=1`, `?pair=<url>`, or a
  `#offer=...` fragment already on the page's own URL, all in `use-connection.ts`) accepts either:
  a direct daemon address (`ws://`/`wss://`, `http://`/`https://` mapped to `ws`/`wss`, or a bare
  `host:port`, normalized by `lib/connection/normalize-url.ts`), or a full pairing link from
  `pi-studio daemon pair` (architecture/relay-e2ee.md § Pairing) pasted verbatim. `connection-
  store.ts#connect()` routes between the two via `resolveConnectTarget()`
  (`lib/connection/resolve-connect-target.ts`), which detects a pairing link via `@av-pi-studio/
  client`'s `parsePairingUrl` and switches to `createRelayTransport` when the link carries a relay
  offer — the daemon password field is ignored for a relay connection; the pairing link's public
  key is itself the credential. Accepting an Electron-injected daemon URL (via `contextBridge`) and
  adding `getIsElectron()` platform gating are **not yet implemented** — both are
  sprint-033-desktop/task-001 scope, to be added to `connection-store.ts` and a new
  `platform/electron.ts` module respectively when that sprint is implemented.
- **File upload/download/delete run only against a daemon that wires `FileTransferService` +
  `FileExplorerService`'s `file_delete_request`** (`bootstrap.ts` — the production bootstrap;
  `dev-bootstrap.ts` wires `FileExplorerService` for listing/preview but NOT `FileTransferService`,
  so upload/download RPCs have no handler there). The dev daemon also registers no terminal-RPC
  service (`create_terminal_request` has no handler under `dev-bootstrap.ts`) — smoke-testing the
  Files sidebar's transfer actions or terminals (via `Ctrl/Cmd+T` or the TabStrip "+" menu) needs
  `npm start`/`npm run start:server`, not `npm run dev:daemon`.
- **No confirmation for upload overwrite/delete happens server-side.** `FileExplorer.tsx` confirms
  an upload that would clash with an existing name before calling `useFileTransfer().upload()`;
  `FileContextMenu.tsx` confirms before `file_delete_request`. The daemon executes both
  unconditionally (overwrites/`rm -rf`s whatever resolved path it's given) — never skip the
  client-side confirm when adding new callers.
- **Steering (mid-turn injection).** While `session.status === "running"`, `Composer.tsx`'s primary
  action becomes **Steer** instead of **Send** (`send_agent_prompt` is only legal when idle) — Enter
  routes through `submit("steer")`, calling `client.agent(id).steer(prompt, {clientMessageId,
  images})`. Steer reuses the exact optimistic-echo + reconciliation path Send uses
  (`addOptimisticUserMessage`/`onUserMessage` in `timeline/reducer.ts`), just with a `queued: true`
  flag on the inserted `UserRow`. A `queue_update` stream event (`{steering: string[], followUp:
  string[]}`, no ids — best-effort text correlation) clears `queued` once the row's exact text is no
  longer listed (`reducer.ts`'s `onQueueUpdate`, wired into `applyStreamEvent`'s `queue_update`
  case); `UserRow.tsx` renders a small "queued" pill while it's set. Follow-up (`.followUp(...)`,
  delivered only once the turn fully stops) is SDK/CLI-only — intentionally not surfaced in this UI.
