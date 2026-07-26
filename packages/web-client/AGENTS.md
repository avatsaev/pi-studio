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

React 19 · TypeScript 6 (ESM) · Vite 6 · Zustand (client state) · TanStack Query + Virtual ·
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
  stores/                  Zustand slices: ui-store, tab-store (openNewChat materializes eagerly;
                           closeTab wraps the store's close action + materialize.ts's
                           discardIfEmpty), session-store (SessionEntry.model/modelProvider,
                           poll-reconciled + live-updated by agent_update), materialize (eager
                           draft materialization + default-model resolution + discardIfEmpty, +
                           test), git-store (branch/ahead/behind/detached/upstream/conflictCount
                           alongside changes[]), stats-store (per-sessionId context/tokens/cost/
                           model — sprint-042), explorer-store (+ test)
  timeline/                streaming/render model: reducer, row-model, tool-mapping, markdown,
                           highlight (+ tests)
  hooks/                   use-connection (boot), use-session-restore (session directory restore
                           + a connection-lifetime `agent_update` listener that keeps
                           session-store.model live on an explicit `/model` set), use-session-stats
                           (per-session context/token/cost/model poll — sprint-042, see AGENTS.md
                           § Invariants "Status bar"), use-terminal-restore
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
                            to the active workspace — GitHub issue #8), TabPanelHost, panel-registry,
                            StatusBar (+ status-bar-format.ts pure formatters) — bottom powerline
                            bar, see AGENTS.md § Invariants "Status bar"
    workspace-picker/       OpenWorkspaceDialog (directory browser)
    chat/                   ChatPanel, Timeline, Composer, ModelMenu (status bar's model-selector
                            searchable popup, sprint-043 — see AGENTS.md § Invariants "Model
                            selector"), Attachments, rows/ (Assistant/User/System/Error/Reasoning
                            rows, ToolCard)
    files/                  FilePanel, FileExplorer (tree view: lazy per-directory expansion
                            tracked in explorer-store + fetched via use-explorer-tree, rows
                            flattened by file-tree.ts and rendered through
                            @tanstack/react-virtual; upload button/drag-and-drop resolved to the
                            drop-target directory; per-row "⋮" context-menu trigger; header +
                            context-menu "New File"/"New Folder" actions insert an inline
                            TreeDraftRow under the target directory, named in place and created
                            on Enter), TreeNode (presentational row: chevron/icon/name + actions
                            button, delegates draft rows to TreeDraftRow), TreeDraftRow (owns the
                            draft input's local text state), FileContextMenu (New File/New
                            Folder/download/delete), create-entry.ts (shared `file_create_request`
                            caller + error-code messages, used by FileExplorer's tree draft and
                            OpenWorkspaceDialog's "new folder" affordance), RightSidebar, DiffView,
                            CodeView, MarkdownFileViewer, ImageViewer, VideoViewer,
                            BinaryFallbackViewer, TextViewer, viewer-registry
    git/                    ChangesPanel (pure `git-store` consumer — see AGENTS.md § Invariants
                            "Status bar" for why it no longer owns its own checkout-status
                            subscription)
    terminal/               TerminalPanel (one xterm instance per open terminal tab; opening a
                            tab whose `data.slot` is already known — e.g. from
                            `use-terminal-restore.ts` — subscribes to the existing PTY instead of
                            spawning a new one). No dedicated "Terminals" management view —
                            orphaned terminals reopen automatically as tabs on connect.
  routes/                  WorkspacePage (the 3-column shell: sidebar-left / center / sidebar-right,
                           plus the full-width `StatusBar` pinned to the bottom of `.shell`)
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
- **Zero agents on connect ⇒ no workspace, not a phantom one.** `use-session-restore.ts` only ever
  restores from `list_agents_request`'s results — if the daemon reports zero agents, the hook
  returns without touching `tab-store`/`ui-store` at all: `activeWorkspaceCwd` stays `null` and no
  session/tab is created. (It previously called `openNewChat` in this case, materializing a
  client-only session rooted at a guessed home dir and paying an unwanted `resolve_default_model`
  RPC on every fresh connect — removed.) `TabPanelHost.tsx` renders a dedicated "No workspace open"
  empty state (with an "Open Workspace" button wired to `ui-store.openCwdPicker()`) specifically
  for `activeWorkspaceCwd === null`, distinct from its "workspace in view, no tabs yet" state;
  `SessionList.tsx`'s sidebar shows a matching "No workspaces — open a folder to start" (or
  "Not connected") hint instead of a blank rectangle. A workspace exists only because the user
  opened one via `OpenWorkspaceDialog`, or because a restored agent carried a `cwd`. `?cwd=` (see
  above) is no longer write-only in this state: `OpenWorkspaceDialog` seeds its picker from
  `activeWorkspaceCwd || ui-store.cwd || "~"`, so the deep-link param (or the last workspace
  opened) still does something useful even with no workspace in view.
- **File upload/download/delete run only against a daemon that wires `FileTransferService` +
  `FileExplorerService`'s `file_delete_request`** (`bootstrap.ts` — the production bootstrap;
  `dev-bootstrap.ts` wires `FileExplorerService` for listing/preview but NOT `FileTransferService`,
  so upload/download RPCs have no handler there). The dev daemon also registers no terminal-RPC
  service (`create_terminal_request` has no handler under `dev-bootstrap.ts`) — smoke-testing the
  Files sidebar's transfer actions or terminals (via `Ctrl/Cmd+T` or the TabStrip "+" menu) needs
  `npm start`/`npm run start:server`, not `npm run dev:daemon`. Creating a file/folder
  (`file_create_request`, also on `FileExplorerService`) works under both bootstraps, unlike
  upload/download.
- **No confirmation for upload overwrite/delete happens server-side.** `FileExplorer.tsx` confirms
  an upload that would clash with an existing name before calling `useFileTransfer().upload()`;
  `FileContextMenu.tsx` confirms before `file_delete_request`. The daemon executes both
  unconditionally (overwrites/`rm -rf`s whatever resolved path it's given) — never skip the
  client-side confirm when adding new callers. Creates (`create-entry.ts`) are the deliberate
  exception: `mkdir` is non-recursive and file creation opens `wx` (create-exclusive, never
  truncates), so a name collision fails loudly with an `"exists"` error instead of needing a
  confirm dialog — do not "improve" this by switching to `{ recursive: true }` or `"w"`.
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
  `Composer.tsx` tracks **two independent busy flags** (`sending` for Send/create-agent, `steering`
  for Steer) rather than one shared flag: the Send/create-agent RPC blocks server-side for the
  *entire* turn (`AgentService.runTurn` doesn't resolve until the turn ends), so a single shared
  flag left the Steer button disabled for the whole turn — the button's `disabled` is keyed off
  whichever flag matches the currently-rendered action (`running ? steering : sending`).
- **Model selector (sprint-043, moved to the status bar) + eager draft materialization.**
  `ModelMenu.tsx` (`features/chat/`) is the shared popup: a Radix `DropdownMenu` with a fuzzy
  search input (`ui/combobox.ts`'s `filterOptions`, case-insensitive on label + id), the current
  model sorted first with a checkmark (`model-menu-sort.ts`'s pure `sortCurrentFirst`,
  unit-tested — kept out of the `.tsx` file since the root Vitest config only discovers
  `.test.ts`, not `.test.tsx`, under a node environment; there is no jsdom/React-Testing-Library
  render test anywhere in this package despite `@testing-library/react` being a devDependency —
  see `StatusBar`'s precedent below), and rows showing `label (id)` with the id in
  `--pi-color-foregroundMuted`. Each model row carries its own underlying LLM `provider` (e.g.
  `"anthropic"`) alongside its `id` (`AgentModelDefinition.provider`/`ProviderModel.provider`,
  threaded through from Pi's own `Model` object — see `packages/server/AGENTS.md` §
  ProviderRegistry). `ModelMenu` itself no longer owns a trigger element: it takes a
  `renderTrigger(currentModel)` prop and wraps whatever the caller renders in
  `DropdownMenu.Trigger asChild` — originally the composer's own ghost button, now
  `StatusBar.tsx`'s icon+text segment button (`styles.modelSegment`), showing `session.model` or
  a `"Model"` placeholder. The composer no longer renders `ModelMenu` or holds any model-picking
  code; picking still updates `SessionEntry.model`/`modelProvider` through the same store action,
  so whichever materialize path is currently in flight sees the same value regardless of where
  the pick happened.

  **A brand-new "New chat" tab materializes the instant its tab is created, not on first
  keystroke/pick/send.** `tab-store.ts`'s `openNewChat` fires `stores/materialize.ts`'s
  `ensureMaterialized(client, id)` right after `createSession`+`open` — the tab/sidebar row
  appear synchronously, and the real, persisted `AgentRecord` (see below) is created in the
  background, best-effort (a failure or an offline open is retried by `Composer.tsx`'s `submit()`,
  which still calls `ensureMaterialized` unconditionally before every send — the one remaining
  place other than `openNewChat` and `StatusBar.tsx`'s `handleSelectModel` that calls it).
  `ensureMaterialized` itself resolves the default model (`resolveDefaultModel`, a daemon-cached
  `resolve_default_model` lookup — `packages/server/AGENTS.md` § `ProviderRegistry`) when the
  entry has none yet, seeding `session.model`/`modelProvider` from it — re-checking the CURRENT
  entry (not a stale snapshot) right before applying that default, so an explicit pick that lands
  while the lookup is still in flight always wins over the resolved default, never the reverse.
  `ensureMaterialized` is a no-`initialPrompt` `client.createAgent(...)` that the daemon persists
  WITHOUT spawning a provider process (`packages/server/AGENTS.md` § "Deferred draft creation"),
  carrying whatever model is on the (possibly just-seeded) entry as `config.model`/
  `config.modelProvider`. The daemon replays that pinned model on the process's first real spawn
  (`spawnOrResumeSession`), unconditionally — this is why `setModel` always carries
  `modelProvider` alongside `modelId`, not just for the already-bound case. `ensureMaterialized`
  is idempotent (a no-op once bound) and serializes concurrent callers (eager-open racing a model
  pick racing Send) onto one `createAgent` call via its `materializing` in-flight map — this is
  also why `Composer.tsx` needs no "watch the raw broadcast for the first turn" dance: by the time
  a turn can start, `agentId` is already bound and `useAgentStream` is already subscribed.

  **Once the session has a bound `agentId`,** `StatusBar.tsx`'s `handleSelectModel` still awaits
  `ensureMaterialized` unconditionally (a no-op once bound, the common case now) before firing
  `client.agent(agentId).setModel(modelProvider, modelId)` (`agent_set_model_request`) — one path
  regardless of materialization state, unlike the old branch that returned early (silently
  dropping the pick) whenever a materialize was already in flight, which eager materialization
  made the COMMON case rather than a rare race. Rejections are swallowed with no dedicated UI
  surface (same swallow-and-let-the-broadcast-be-authoritative convention as `Composer.tsx`'s
  `submit()`). **A bound `agentId` does NOT imply a live process** — a deferred draft's `agentId`
  is set the instant it materializes, well before the first send that actually spawns one — so
  this call can legitimately hit an agent with no live session at all. That distinction is
  handled entirely server-side (`agent_set_model_request`'s handler persists directly to
  `record.config` when there's no live session — see `packages/server/AGENTS.md` §
  `list_agents_request`); the client never needs to know which case it's in. **Never pass the
  pi-studio `AgentClient` id (`"pi"`) as this `provider` argument** — that was a real shipped bug
  (`agent_set_model_request` always failed server-side with `"Model not found: pi/<modelId>"`,
  silently reverting to the default model on the next turn since the change never actually
  applied): Pi's `set_model` RPC's `provider` field is the model's own LLM provider, a completely
  different namespace from the pi-studio provider id used only to pick which `AgentClient`
  answers `list_provider_models`. Model discovery goes through the daemon's
  `list_provider_models` RPC (both bootstraps, backed by `AgentClient.listModels` with no spawned
  agent — see `packages/server/AGENTS.md` § ProviderRegistry and `packages/client/AGENTS.md` §
  `PiStudioProviderActions`).

  **A never-used chat is discarded on close, not left as clutter — but persists across a refresh
  until then.** Because every "New chat" tab now persists an `AgentRecord` immediately, closing it
  without ever sending anything (or even just picking a model) would otherwise leave an empty,
  permanently idle record behind. Every UI close path (`TabStrip.tsx`'s × and middle-click,
  `use-shortcuts.ts`'s Ctrl/Cmd+W) MUST go through `tab-store.ts`'s exported `closeTab(tabId)`
  wrapper, never `useTabStore.getState().close` directly: it closes the tab as before, then —
  only for a `"chat"` tab — fires `materialize.ts`'s `discardIfEmpty(client, sessionId)`, which
  hard-deletes the agent (`delete_agent`) and removes the local `SessionEntry` when
  `userMessageCount === 0` AND the timeline has zero rows (awaiting any still-in-flight
  `ensureMaterialized` first, so the record it's about to create doesn't leak). A session with
  ANY timeline row — including a queued/optimistic one — is kept; `SessionContextMenu.tsx`'s
  explicit Archive/Delete actions are untouched (an explicit delete must never depend on
  emptiness). **`use-session-restore.ts` hydrates every known agent unconditionally, including an
  idle, still-empty draft** — a materialized-but-untouched "New chat" is a real persisted session
  the instant `openNewChat` creates it, not a phantom the UI should hide on reconnect; it stays
  visible (and its tab reopens) across a refresh/reconnect for as long as nobody explicitly closes
  it or deletes it. Only `closeTab`'s `discardIfEmpty` (above) or an explicit delete ever removes
  one.
- **Status bar (sprint-042).** `StatusBar.tsx`, mounted once in `WorkspacePage` (always on
  screen, unlike any feature panel), renders six segments for the **active session** in order:
  model, cwd, git branch (+ ahead/behind/dirty/conflict), context usage, token total, cost. The
  model segment is the only interactive one (sprint-043) — a button rendering `ModelMenu`'s
  `renderTrigger`, always shown while a session is active (even before a model is known, as a
  `"Model"` placeholder), unlike the other five which are plain icon+text and only render when
  their underlying value exists (`gitAvailable`, `session`, …). Its leading chevron is therefore
  driven separately from the generic segment loop's `i > 0` check — see the render's `Boolean(session)
  || i > 0` condition — since it sits outside the `segments` array those five build. Reads
  `session-store`/`git-store`/`stats-store` (all reactive selectors); polls via
  `useSessionStats(activeSessionId)`. Two subtleties that matter if you touch this area:
  - **`StatusBar` is the SOLE owner of the checkout-status subscription** (`useCheckoutStatus`),
    keyed off `tab-store.activeWorkspaceCwd` — NOT `session.cwd` (a per-session field), and NOT a
    per-panel subscription. `ChangesPanel.tsx` used to own this subscription itself, opening it
    only while the Changes tab was visible; it is now a pure `git-store` reader. The daemon's
    `checkout_status_subscribe`/`_unsubscribe` handlers key on a flat, non-reference-counted
    `session:cwd` map (`packages/server/src/projects/git-checkout-rpc.ts`) — a SECOND independent
    subscriber to the same cwd is not additive, it's a race: whichever one unmounts first silently
    kills the live feed for the other too. Never add a second `useCheckoutStatus(cwd)` call
    anywhere in this app for the same cwd `StatusBar` is already watching.
  - **The context/token/cost/model fields are pull-only** — no `AgentStreamEvent` kind carries
    them (see `agentStreamEventSchema` in `@av-pi-studio/protocol`). `use-session-stats.ts` polls
    `client.agent(id).sessionStats()` on mount/session-switch, on a ~12s interval, and immediately
    when the session's `status` transitions away from `"running"`. Its `applySessionStats` also
    writes a poll-returned `model` back into `session-store` (not just `stats-store`) — the model
    *segment* reads `SessionEntry.model`, so skipping this write-through leaves the segment
    permanently blank even though the poll succeeded (a real bug this sprint's live smoke test
    caught before it shipped).
- **Timeline auto-scroll's mount-time "grew" ref must revert on cleanup.** `Timeline.tsx`'s
  stick-to-bottom effect compares `session.timeline.rows.length` against a `prevRowCountRef` to
  decide whether to re-run `virtualizer.scrollToIndex(rows.length - 1, {align: "end"})` — but
  without an explicit cleanup that restores the ref's PREVIOUS value, this silently breaks under
  React StrictMode's dev-only double-invoke (mount → phantom cleanup → mount, same instance, no
  actual teardown — see `TerminalPanel.tsx`'s own doc comment for the established pattern): the
  phantom first invocation already flips the ref, so the real second invocation sees `grew ===
  false` and skips the scroll — right as `@tanstack/react-virtual`'s OWN scroll-element
  re-attachment (which correctly redoes itself across that same phantom cycle) resets the DOM
  `scrollTop` back to `0`. Net effect (a real, live-verified bug, not theoretical): every
  freshly-opened or freshly-restored chat tab with existing history opened at the TOP instead of
  the bottom — confirmed via a `scrollTo` call-stack trace showing the sequence `0` (virtualizer's
  first attach) → correct offset (this effect) → `0` again (virtualizer's phantom-cycle
  re-attach, unopposed because the ref-guard silently ate the real second invocation). Fixed by
  returning `() => { prevRowCountRef.current = prevCount; }` from the effect.
