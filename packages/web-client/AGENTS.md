# `@av-pi-studio/web-client` — AGENTS.md

Production React web client for Pi-Studio. Re-implements the `poc/chat.html` proof of concept as a
modular, typed, performant app.

> **Status: implemented.** The 3-column workspace shell, connection layer, sessions sidebar,
> chat/timeline, composer, file explorer + viewers, git changes panel, terminals, and the design
> system are all built and wired. Two Vite build targets (`build:web` / `build:electron`) exist, but
> the **Electron-specific runtime code does not exist yet** — no `getIsElectron()`, no injected
> daemon URL, no `contextBridge` consumer. That is `swe/sprints/sprint-033-desktop`
> scope (task-001), not shipped. See `POC_TO_APP_PLAN_UI.md` at the repo root for the original phased
> plan this was built against.

> **Design system reference:** `DESIGN_SYSTEM.md` (this directory) documents the full token
> pipeline, color system, theme variants, brand/white-label injection, breakpoints, and every
> shared primitive — read it before adding a new component or hardcoding a style value.

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

**Packaging: every entry in `package.json` is a `devDependency`, not a runtime `dependency`.**
This package has no `main`, no `exports`, and no `bin` — it ships only the prebuilt static assets
under `files: ["dist", ...]`; nothing at a consumer's runtime ever resolves `@av-pi-studio/client`,
`react`, `mermaid`, etc. through `node_modules` (`vite.config.ts` aliases `@av-pi-studio/protocol`/
`client` to sibling `src/index.ts` at build time; `tsconfig.json` uses project references). Keeping
them as `dependencies` made every `npm install @av-pi-studio/cli` pull this package's entire
build-only tree (627 MB / 824 packages) even though only `dist/web` is ever used. If a future
consumer needs to `import` this package's source as a JS module rather than serve its static build,
it must declare those libraries itself.

---

## Stack

React 19 · TypeScript 7 (ESM) · Vite 6 · Zustand (client state) · TanStack Query + Virtual ·
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
  global.css               resets + scrollbar; colors and font sizes come from theme --pi-*
                             vars (font-size scale lives in theme/tokens.ts, see Invariants)
  theme/font-scale.test.ts guards the one-lever font invariant: no hardcoded font-size literal
                             in any CSS module, no dangling --pi-font-size-* rung
  theme/token-integrity.test.ts generalizes the same guard to every --pi-*/--syntax-* custom
                             property across every source file (not just font-size): every
                             var(--pi-*) reference must resolve to a key theme/css-bridge.ts
                             actually emits, AND every emitted key must be a syntactically legal
                             CSS custom-property identifier (no literal `.` — a fractional
                             spacing key like "1.5" silently emits an invalid `--pi-spacing-1.5`
                             that no browser resolves, collapsing that padding/margin/gap to 0
                             app-wide with no error; this shipped once, see theme/tokens.ts's
                             spacing comment)
  css-modules.d.ts          ambient CSS-module typings
  vite-env.d.ts             ambient `__APP_VERSION__`/`__BRAND_TITLE__` typing (vite.config.ts
                             `define`s — own package.json version and the build-time brand-title
                             override, both shown in ConnectionBar.tsx)
  providers/               AppProviders (ThemeBoundary + QueryClientProvider), kv-store (localStorage-backed KeyValueStore)
  theme/                   tokens, palette, color-utils, variants, appearance-store, css-bridge, theme.ts, ThemeBoundary
  brand/                   build-brand.ts (+ test) — the LIVE build-time title/favicon override
                            (`PI_STUDIO_BRAND_TITLE`/`PI_STUDIO_BRAND_ICON`, wired in
                            vite.config.ts's `brandHtmlPlugin`, see § Invariants "Build-time brand
                            override"); config.ts (zod BrandConfig: colors/logo triplet/links/
                            legal) + theme-injection.ts (accent-only injection seam) are a
                            separate, broader scaffold ported from `white-label-branding.md`'s
                            clean-room spec that is NOT wired to any loader — `getActiveBrand()`
                            always returns `DEFAULT_BRAND`; no caller passes `ThemeBoundary` a
                            `brandConfig` today
  ui/                      framework-free design-system logic (button/select/status/toast/shortcut/avatar tokens)
  platform/                breakpoints (window-chrome metrics)
  components/primitives/   React design-system components (Button, IconButton — compact
                            chromeless icon affordance for row actions/menu triggers, distinct
                            from Button's ≥28px iconOnly mode —, Select, Dialog, Surface,
                            Panel — full-height flex-column shell —, EmptyState — centered
                            muted placeholder text —, Menu — shared Radix DropdownMenu chrome
                            (MenuCursorTrigger/MenuContent/MenuItem/MenuSeparator), used by
                            every right-click context menu plus TabStrip's "+" menu and
                            ModelMenu/CommandMenu's outer chrome —, TextInput, Switch,
                            Checkbox, Avatar, ScrollArea, ResizeHandle, StatusBadge/Dot,
                            Shortcut, Spinner, ScreenTitle, Divider, Icon, …)
  lib/connection/          connection-store (Zustand + DaemonClient/PiStudioClient; also handles
                           relay-transport pairing-link connections; constructs
                           ReconnectionManager with createWorkerTimers()'s injected timers —
                           sprint-050), resolve-connect-target (pure routing: plain address vs.
                           pairing link, direct vs. relay + tests), normalize-url (accepts
                           ws/wss/http/https/bare-host, maps http→ws / https→wss), query-client
                           (TanStack Query), rpc-keys, files-changed (cache-invalidation
                           signaling), worker-timers (createWorkerTimers — setTimeout/clearTimeout
                           backed by a lazily-created, module-level shared Worker built from an
                           inline Blob URL, exempt from hidden-tab timer throttling; falls back to
                           plain setTimeout, latched, if Worker construction is unavailable or
                           throws — sprint-050, see Invariants "Connection resume triggers") (+
                           test, fallback path only — no DOM Worker in this repo's Vitest
                           environment), resume-action (resolveResumeAction — pure decision core:
                           status/managerActive/probeInFlight → none/reconnect-now/probe — sprint-050)
                           (+ test, full decision table), resume-triggers (attachResumeTriggers —
                           visibilitychange/online DOM wiring installed once at module scope in
                           main.tsx, outside React/StrictMode — sprint-050, see Invariants
                           "Connection resume triggers")
  lib/protocol/            events.ts (protocol event helpers), timeline-paging.ts
                           (fetchTimelineEvents — drains every `fetch_agent_timeline_request` page
                           into one ordered event list; see Invariants "Restored history") (+ test)
  lib/paths.ts             resolveWorkspacePath — shared relative-path + base joiner (moved out
                           of use-file-live-refresh.ts, task-002 sprint-045; also used by
                           timeline/image-src.ts's relative-path branch); dirOf (parent directory
                           of an absolute path) and relativeToRoot (strip a workspace root prefix)
                           — file-explorer quick-wins-1, used by FileContextMenu.tsx's Copy Path
                           actions and FileExplorer.tsx's selected-directory targeting;
                           collapseDotSegments (sprint-051) — lexical `.`/`..` segment collapser,
                           no filesystem access, applied by timeline/href-resolution.ts's shared
                           classifier-resolution step (never by resolveWorkspacePath itself, which
                           stays byte-identical for its existing callers)
  lib/clipboard.ts         copyText — Clipboard-API write with an execCommand("copy") fallback
                           for non-secure-context LAN access (file-explorer quick-wins-1)
  lib/drag-guard.ts        armDragGuard/disarmDragGuard + DRAG_GUARD_ATTR — sets `data-pi-dragging`
                           on <body> for the duration of ANY drag, which global.css pairs with
                           `body[data-pi-dragging] iframe { pointer-events: none }` so a
                           cross-document child (HtmlViewer's preview) stops hit-testing and the
                           pane drop targets beneath it stay reachable; armed by use-pane-drag's
                           dnd-kit callbacks and by use-external-pane-drop's document-level
                           dragstart/dragend/drop listeners (+ test — guards the attribute against
                           drifting from the CSS selector)
  lib/random-id.ts         randomId — portable id generator (pane ids, optimistic-echo
                           `clientMessageId`s, Mermaid DOM ids) using crypto.getRandomValues
                           (works in non-secure contexts, unlike crypto.randomUUID) with a
                           timestamp+Math.random fallback when crypto itself is unavailable;
                           same non-secure-context LAN-access rationale as lib/clipboard.ts —
                           never call crypto.randomUUID() directly in this package, use this
  lib/inline-image-cache.ts ref-counted, LRU-bounded (32-entry) object-URL cache for inline chat
                           images (task-003 sprint-045); revokes only on LRU eviction or
                           connection teardown, never on row unmount — deliberately NOT
                           use-file-download's single-consumer/revoke-on-unmount policy
  lib/pane-layout-persistence.ts
                           versioned, client-local pane-layout record (localStorage key
                           `pi-studio-pane-layout` via providers/kv-store) keyed by stable
                           **tab identity**, not tab id (`tabIdentity`, in tab-store — a terminal's
                           tab id changes across a reconnect, `term-new-<n>` → `term-<slot>`, and a
                           chat's session id is re-minted on every load, so a chat is keyed on its
                           daemon-side `agent:<agentId>`); trailing-debounced writes on THREE
                           triggers — a layout mutation, plus tab-store and session-store for
                           identity acquisition (a terminal's slot arriving, a draft chat's
                           `bindAgent`), each compared against an identity signature so a rename or
                           status change writes nothing; also carries top-level
                           `activeWorkspaceCwd` (which workspace was in view — geometry is per
                           workspace, so without it restore lands on whatever the session inventory
                           activates); writes layer live tabs OVER unconsumed claims so a mid-restore
                           write cannot orphan a pane; `loadPaneLayout` returns a `LoadedPaneLayout`
                           (`{ workspaces, activeWorkspaceCwd }`) validated via pane-tree's
                           `parsePaneTree` (sprint-048/049) (+ test)
  stores/                  Zustand slices: ui-store (fileMenu carries a `background` flag for the
                           Files tree's empty-space context menu; `collapsedWorkspaces` seeded in
                           bulk via setCollapsedWorkspaces, not just toggled one at a time),
                           tab-store (`activeTabId` is DERIVED — a cached projection of
                           layout-store's focused pane and its active tab, written only by
                           `syncActiveFromLayout()`; every lifecycle method routes through
                           layout-store, and `useIsTabVisible(tabId)` — not `=== activeTabId` — is
                           what panels ask, since with splits several tabs are visible at once;
                           `tabIdentity()` lives here because `open` calls it on every open to
                           resolve a persisted claim; the `openNew*` helpers take an optional target
                           pane; openNewChat materializes eagerly; closeTab wraps the store's
                           close action + materialize.ts's discardIfEmpty; closeByPathPrefix closes
                           every file/diff/molecule tab nested under a deleted path), session-store
                           (SessionEntry.model/modelProvider, poll-reconciled + live-updated by
                           agent_update), materialize (eager draft materialization + default-model
                           resolution + discardIfEmpty, + test), git-store (branch/ahead/behind/
                           detached/upstream/conflictCount alongside changes[]; plus `ignored[]`,
                           the projection's gitignored paths — kept OUT of `changes[]` so it can
                           never inflate the Changes tab or the status bar's dirty count, and read
                           only by the Files tree), stats-store
                           (per-sessionId context/tokens/cost/model — sprint-042), explorer-store
                           (`selected` — the last-clicked row, target directory for "New File"/
                           "New Folder" — file-explorer quick-wins-1; `repathAfterMove` — rewrites
                           `expanded`/`selected` after a move so tree state follows the moved
                           subtree to its new prefix instead of pointing at dead paths —
                           sprint-046) (+ test), layout-store (pane structure per workspace:
                           pane tree, tab→pane `placement`, per-pane active tabs, focused pane,
                           plus the restore claim/settle-point machinery — sprint-048) (+ test)
  timeline/                streaming/render model: reducer, row-model, tool-mapping, markdown
                           (react-markdown wrapper; `Markdown` for finalized text and
                           `StreamingMarkdown` for a row still being written; `img` node →
                           InlineImage, `a` node → FileLink), streaming-split
                           (splitStreamingMarkdown — pure block/tail split that makes live markdown
                           affordable during streaming; see § Invariants) (+ test),
                           InlineImage (task-004 sprint-045, click/drag wiring converged in
                           sprint-051 — the `![alt](src)` renderer: remote passthrough, local fetch
                           via use-inline-image, click-to-open + drag-to-split via the shared
                           file-open-target/external-drag helpers), FileLink (sprint-051 — the
                           `[label](href)` renderer: external passthrough, local click-to-open +
                           drag-to-split, sibling to InlineImage), inline-image-view
                           (selectInlineImageView — pure render-decision selector InlineImage
                           switches on, extracted per the no-jsdom convention below),
                           href-resolution (resolveHrefCandidate — the scheme/tilde/relative
                           resolution step image-src and file-link-src share; normalizes via
                           lib/paths.ts's collapseDotSegments and percent-decodes, sprint-051),
                           file-open-target (resolveFileOpenTarget — pure workspaceCwd/targetPaneId
                           resolution FileLink and InlineImage's click handlers share, sprint-051),
                           highlight, image-src (classifyImageSrc — pure markdown image-source
                           classification: remote/local/unresolvable, task-002 sprint-045),
                           file-link-src (classifyFileLinkSrc — pure markdown link-source
                           classification: local/external, sprint-051), bottom-anchor
                           (nextAnchorState/isLaidOut/lastRowUserId + AT_BOTTOM_THRESHOLD_PX —
                           the pure follow-the-bottom policy Timeline drives through
                           features/chat/use-bottom-anchor; see AGENTS.md § Invariants "Timeline
                           bottom anchor") (+ tests)
  hooks/                   use-connection (boot), use-pane-layout (usePaneLayoutBoot — installs the
                           persisted layouts as pending claims, replays the client-side tabs
                           (reopen-client-tabs.ts), and wires the persistence writer; MUST run after
                           the connection boot but before the restore hooks, so a
                           restored tab finds its claim), use-pane-drag (the shared pane
                           drag-and-drop session: pointer tracking, live drop resolution via
                           pane-dnd, and the commit), use-external-pane-drop (the NATIVE-DnD
                           counterpart: a chat dragged out of the session list or a file out of the
                           Files tree onto a pane body — `applyExternalDrop` is exported for direct
                           unit testing) (+ test), use-session-restore (session directory restore
                           — pages each agent's timeline to completion via lib/protocol/timeline-paging,
                           reopens EVERY hydrated chat a persisted pane still claims (falling back to
                           the most recent one when nothing is claimed),
                           + a connection-lifetime `agent_update` listener that keeps
                           session-store.model live on an explicit `/model` set), use-session-stats
                           (per-session context/token/cost/model poll — sprint-042, see AGENTS.md
                           § Invariants "Status bar"), use-terminal-restore
                           (one-shot reopen of every daemon-side terminal as a tab on connect —
                           the safety net for terminals that outlive their tab, e.g. a daemon
                           restart or a terminal created outside this UI; both restore hooks
                           export their one-shot body as `runSessionRestore`/`runTerminalRestore`,
                           each reporting its half of layout-store's initial-hydration settle
                           point in a `finally` — restore-hydration.test.ts), use-shortcuts,
                           use-explorer, use-explorer-tree (one query per expanded tree directory,
                           feeds FileExplorer's flattened row list), use-file-read/-diff/-download,
                           use-file-transfer (upload + save-to-disk actions, shared
                           FileTransferClient via file-transfer-instance), use-checkout-status,
                           use-file-watch (ref-counted, resolved-path-aware `file_changed`
                           subscription shared by the molecule viewer's reload gate and
                           use-file-live-refresh below), use-explorer-watch (live file-tree
                           subscription, one per expanded directory), use-file-live-refresh
                           (drives live refetch for FilePanel tabs whose `ViewerKind` is in the
                           registry-derived `LIVE_REFRESH_KINDS` set — sprint-044, see AGENTS.md
                           § Invariants "Live file watching"),
                           use-file-text (tier-2 streamed-text fallback: decodes a chunked binary
                           download to text, decode query keyed on the download's object URL so
                           it follows a live refetch automatically), use-file-source (task-002
                           sprint-063 — the shared three-tier size ladder every text-shaped viewer
                           now goes through: `useFileRead` → `useFileText` when over the inline
                           cap and under `MAX_DISPLAY_BYTES` → a terminal download-only state
                           above it; decision core is the pure `text-viewer-state.ts` selector,
                           unmoved; consumed by TextViewer, MarkdownFileViewer, and HtmlViewer),
                           use-inline-image (loadInlineImage — the framework-free effect core,
                           per the jsdom-less testing convention below — over
                           inline-image-cache, task-003 sprint-045;
                           consumed by timeline/InlineImage.tsx, task-004)
  use-agent-stream (+ agent-stream-events), use-home-dir, use-provider-models (model-picker RPC
                           query), use-agent-commands (composer `/` picker RPC query — cached
                           identically to use-provider-models, see AGENTS.md § Invariants
                           "Slash-command picker"), use-provider-auth-list (sprint-065/task-006 —
                           wraps `listProviderAuth()` under `rpcKeys.providerAuthList()`; shared by
                           `ModelProvidersPanel` and `Timeline`'s onboarding nudge so a login/logout
                           in either surface invalidates one cache, never two fetch paths)
  features/
    connection/            ConnectionBar (the 42px top row: brand/version, status pill, url+password
                            fields, one primary connect/disconnect action, the two panel toggles —
                            design spec § 08; replaced Toolbar + ConnectionStatus),
                            connection-presentation.ts (+ test — `connectionBarView`/
                            `connectionDot`/`shortConnectionReason`/`isDialableTarget`, the single
                            ConnectionState→bar-state module)
    sessions/               SessionList (handleDeleteWorkspace — loops `client.agent(id).delete()`
                            over a workspace's sessions, confirms conversations-only/files-
                            untouched, closes their tabs — file-explorer quick-wins-1; its rows are
                            also the drag source for chat→pane drops, and only for the workspace in
                            view; also renders the per-workspace "+ New session" row and the
                            pinned "+ Add workspace" footer, sprint-062), session-presentation.ts
                            (+ test — `sidebarSessionView`/`workspaceAttentionDot`, the single
                            SessionEntry→sidebar-row-state module, sprint-062), SessionItem
                            (presentational frameless row — status-only meta, `draggable` decided
                            by SessionList, sprint-062 redesign), SessionContextMenu,
                            WorkspaceGroupHeader (full-bleed `surface2` band — chevron/avatar/bold
                            name/collapsed-only attention dot/count pill, sprint-062 redesign; its
                            "⋮" keeps the per-workspace delete button alongside "New
                            conversation"), open-chat-tab.ts (shared "open a session as a chat
                            tab" dispatch — the sibling of files/open-file-tab.ts, and required
                            for the same reason: three call sites had grown their own copy of the
                            tab literal that `tabIdentity` keys the persisted layout off),
                            open-workspace, status-map,
                            workspace-grouping (+ collapseInactiveWorkspaces, used by
                            use-session-restore.ts to seed the sidebar's collapsed set on connect
                            — file-explorer quick-wins-1) (+ test)
    workspace/              TabStrip (ONE PER PANE — soft-pill tabs that shrink and ellipsise their
                            own label before the tab list scrolls (sprint-061 redesign); trailing
                            chrome (the "+" menu — New chat / New terminal / New molecule, all
                            targeting THIS pane — then a `.stripActions` cluster: SplitActions' Split
                            right / Split down, each disabled with a reason from pane-tree's
                            `canSplit`) stays outside that scroll container so it's reachable in a
                            narrow pane — sprint-049), tab-attention.ts (pure: which chat tab, if any,
                            gets the background-turn `StatusDot`) (+ test), TabPanelHost (flat host:
                            every open tab's panel is mounted
                            exactly once and absolutely positioned at its pane's fractional rect, so
                            rearranging panes never remounts a panel — sprint-049), PaneDividers
                            (one hit target per divider from pane-tree's `dividers()`; dragging
                            calls layout-store.resizeDivider, with the gesture pinned to the handle
                            via setPointerCapture so it survives crossing an iframe — see
                            § Invariants), DropPreview (drag chip + the resolved
                            drop region's ghost rect), pane-dnd.ts (pure drop resolution: pointer →
                            pane + region, and whether that means split, move, reorder, or nothing,
                            plus `containsPoint` for the native drag's own hit-testing)
                            (+ test), external-drag.ts (the sidebar→pane transport: one MIME per
                            dragged kind, payload decode, and the shared already-degraded region
                            resolution; documents why that half is native DnD and not dnd-kit)
                            (+ test), pane-layout-view.ts (pure store-tree → renderable
                            rects/dividers projection) (+ test), reopen-client-tabs.ts
                            (`tabFromIdentity` — the exact inverse of `tabIdentity` for the kinds no
                            daemon inventory can rebuild, replayed at boot from the persisted record:
                            file/diff/molecule; see AGENTS.md § Invariants "Who reopens a tab")
                            (+ test), restore-active-workspace.ts (one-shot switch back to the
                            workspace that was in view, armed on connect and fired at the hydration
                            settle point — earlier would be overwritten by the next arriving tab,
                            since every open brings its own workspace into view) (+ test),
                            panel-registry,
                            pane-tree.ts (pure split-pane algebra: leaf/split node model, canSplit/
                            splitPane/removePane with per-branch depth cap and flat-run collapse,
                            paneRects/dividers/resizeAtDivider geometry, effectiveTree, and
                            parsePaneTree for untrusted persisted trees — no React, no store,
                            sprint-048) (+ test),
                            StatusBar (+ status-bar-format.ts pure formatters) — bottom powerline
                            bar, see AGENTS.md § Invariants "Status bar"
    workspace-picker/       OpenWorkspaceDialog (directory browser)
    settings/               SettingsDialog (+ module.css) — the settings shell (sprint-065): a
                            900px `Dialog` with an icon+label category sidebar and a scrollable
                            content pane, opened by ConnectionBar's gear. `SETTINGS_CATEGORIES`
                            is a local registry (`{ id, label, icon, component, available(caps) }`)
                            whose entries are capability-gated; Model Providers is the only one
                            today. Also owns the stacked-dialog dismissal guard — see AGENTS.md
                            § Invariants "Stacked dialogs"
    provider-auth/          ModelProvidersPanel (+ module.css — the Model Providers category: one
                            row per provider with an auth-state badge, subscription tag, and
                            login/re-login/logout actions), LoginDialog (+ module.css — drives one
                            login flow: every prompt kind, the status region, the OAuth
                            presentation (`auth_url` link + copy + QR, `device_code` with a
                            view-local countdown) rendered *concurrently* with a live
                            `manual_code` prompt, terminal success/error with `Try again`),
                            QrCode (+ module.css — wraps `qrcode`'s browser `toDataURL`; the only
                            browser-side QR in the app, and deliberately unthemed so it stays
                            scannable), login-flow.ts (+ test — the pure
                            reducer owning all step/ordering logic),
                            provider-auth-presentation.ts (+ test —
                            `providerAuthBadge`/`providerAuthLoginChoices`),
                            provider-auth-store.ts (the one-flow-at-a-time hand-off between the
                            panel's action and the dialog: pending login + `AbortController` +
                            `attempt`, which `LoginDialog` keys on so a retry remounts clean)
    chat/                   ChatPanel, Timeline (+ onboarding-nudge.ts — sprint-065/task-006's
                            pure `shouldShowProviderOnboardingNudge`: the empty-timeline slot
                            doubles as the "connect a model provider" CTA when the daemon has the
                            capability and every provider is a confirmed `configured: false`;
                            `"unknown"` — a bounded-out `checkAuth()` — suppresses the nudge exactly
                            like a confirmed `true` does, kept out of the `.tsx` for the same
                            jsdom-less reason as `slash-commands.ts` below), TurnProgressBar
                            (indeterminate 2px running-turn bar, mounted absolutely at the top of
                            ChatPanel — see AGENTS.md § Invariants "Turn progress bar"), Composer
                            (bordered card: textarea + bottom action toolbar), ModelMenu (that
                            toolbar's model-selector searchable popup, sprint-043 — see AGENTS.md
                            § Invariants "Model selector"), CommandMenu (composer's `/`
                            slash-command popup — see AGENTS.md § Invariants "Slash-command
                            picker") + slash-commands.ts (pure token/filter/apply logic,
                            unit-tested), use-bottom-anchor (the timeline's bottom-anchor
                            controller: gesture/scroll/resize listeners over
                            timeline/bottom-anchor.ts's pure state machine), Attachments,
                            rows/ (Assistant/User/System/Error/Reasoning rows, ToolCard)
    agent-ui/               Extension-UI dialog rendering (sprint-068 — see AGENTS.md § Invariants
                            "Extension UI dialogs"): agent-ui-store.ts (the app-scoped controller
                            wiring over `@av-pi-studio/client`'s `AgentUiController`/
                            `agent-ui-state.ts`) + AskCard.tsx (the card itself, every method kind,
                            every lifecycle state) + its module.css, keyboard.ts (pure: per-kind key
                            claim, hint content, the two-step Esc state machine), ask-list.ts (pure:
                            pending/resolved merge order, past-four collapse, recovered-marker
                            detection), ask-placement.ts (pure: where cards sit among timeline rows
                            — chronological insertion, never a sort; rows never reorder),
                            outcome-line.ts/option-layout.ts/prompt-text.ts/deadline.ts
                            (pure presentation decisions the card renders, no DOM/React)
    files/                  FilePanel, FileExplorer (tree view: lazy per-directory expansion
                            tracked in explorer-store + fetched via use-explorer-tree, rows
                            flattened by file-tree.ts and rendered through
                            @tanstack/react-virtual, keyed by file-tree.ts's `rowKey` — see
                            AGENTS.md § Invariants "Files tree root row"; the workspace cwd is
                            the tree's own first row, collapsible, with children at depth 1;
                            upload button targets the workspace root;
                            dragging files in from the OS uploads into the hovered row's
                            directory (or the root when dropped on empty space) — restored after
                            an earlier removal (it briefly made the whole panel an ambiguous drop
                            zone) by discriminating the drag kind up front via `dataTransfer.types`
                            (`"Files"` vs the internal move MIME below) before touching any
                            per-row state, so an OS drop can no longer be misrouted by a stale
                            internal-drag ref; per-row "⋮" context-menu trigger; header +
                            context-menu "New File"/"New Folder" target the selected directory
                            (`explorer-store.selected`) instead of always the workspace root — file-
                            explorer quick-wins-1; insert an inline TreeDraftRow under the target
                            directory, named in place and created on Enter; internal row
                            drag-and-drop move — sprint-046: rows are HTML5 drag sources tagged
                            with a custom `application/x-pi-studio-path` MIME (discriminates from
                            an OS-file drag, whose `dataTransfer` exposes the type *list* but not
                            the *value* during `dragover`); hover resolves the legal drop target via
                            move-target.ts's `resolveMoveTarget` (internal move) or
                            directory after 700ms either way, and on drop calls move-entry.ts's
                            `moveEntry` or uploads via `useFileTransfer`'s `upload`. Drag-move and
                            the row context-menu's explicit "Rename" (sprint-047 — reuses the same
                            `file_move_request` with an unchanged parent directory, so no daemon
                            addition was needed) both commit through one shared `applyMove` helper:
                            invalidates both affected `rpcKeys.explorer(...)` listings, repaths
                            `explorer-store` state via `repathAfterMove`, and reopens the moved
                            item's `file`/`molecule` tab at its new path. A `diff` tab on the
                            moved/renamed path always closes and does NOT reopen — right after a
                            rename a per-path `git diff` against the new name renders the whole
                            file as additions, so reopening would replace the real "what did I
                            change" view — but the closed count is folded into the status line via
                            move-status.ts's `withClosedDiffs` ("Renamed to foo.ts — closed 1 diff
                            tab") instead of closing silently; tints
                            every row by git status and ghosts dotfile/gitignored rows from the
                            live `git-store` — see git-status-index.ts below), TreeNode
                            (presentational row: chevron/icon/name + actions button, delegates
                            draft rows to TreeDraftRow; `title` tooltip shows the full path; `active`
                            (open in the current tab), `selected` (last-clicked), and `dropTarget`
                            (hover target for an internal move OR an OS-file drag — sprint-046)
                            rows each get a CSS highlight; `gitStatus` tints the icon + label
                            green/amber/red (`.gitAdded`/`.gitModified`/`.gitDeleted`, same colour
                            convention as the Changes tab's A/M/D badges); `hidden` ghosts the row
                            to 45% opacity (`.hiddenEntry` — dotfiles and gitignored entries, which
                            a plain listing wouldn't show at all), using opacity rather than a
                            colour so it composes with the git tint instead of overriding it, and
                            snapping back to full opacity on hover/active/selected where dimming
                            would just read as broken; row is `draggable` and fires
                            `onDragStartRow`/`onDragEndRow`
                            — file-explorer quick-wins-1), TreeDraftRow (owns the draft
                            input's local text state), TreeRenameRow (owns the rename editor's
                            local text state, same division of labour as TreeDraftRow — pre-fills
                            the current name, selects the basename without its extension on mount
                            (whole name for a directory or a dotfile), Enter/Escape/blur — reused
                            by `TreeNode`'s `row.kind === "rename"` branch, sprint-047),
                            FileContextMenu (row menu: Open / Open in MolViewer (files only) /
                            Open as Text (molecule files only) / New
                            File/New Folder (directories) / Copy Absolute Path / Copy Relative Path
                            / Download (files) / Rename / Delete — Rename sits directly above
                            Delete and triggers ONLY from this menu, never a keyboard shortcut (no
                            F2, no `tabIndex`/`onKeyDown` on `TreeNode` — sprint-047 decision);
                            empty-space variant
                            (`ui-store.fileMenu.background`, right-click below the last row): New
                            File/New Folder/Copy Current Directory Path/Copy Current Directory
                            Relative Path — file-explorer quick-wins-1), open-file-tab.ts (shared
                            "open a path as a tab" dispatch used by FileExplorer's row click,
                            FileContextMenu's Open action, and a Files-tree→pane drop, so all three
                            agree on the molecule-vs-file kind — file-explorer quick-wins-1; also
                            exports the two forced variants that skip that dispatch:
                            `openMoleculeTab` (FileContextMenu's "Open in MolViewer", files only —
                            hands any file to molviewer regardless of `isMoleculeFile`) and
                            `openTextTab` (FileContextMenu's "Open as Text", molecule files only —
                            opens a `kind: "file"` tab so `detectViewerKind` routes the molecule
                            path to `TextViewer`). All three take an optional
                            `targetPaneId`), create-entry.ts (shared
                            `file_create_request` caller + error-code messages, used by
                            FileExplorer's tree draft and OpenWorkspaceDialog's "new folder"
                            affordance), move-entry.ts (shared `file_move_request` caller +
                            error-code messages, same shape as create-entry.ts — sprint-046),
                            move-target.ts (pure `resolveMoveTarget` — drop-legality decision +
                            landing path for a row drag, no React/DOM dependency so it's
                            unit-testable without jsdom — sprint-046),
                            move-status.ts (pure `withClosedDiffs` — appends a singular/plural
                            "closed N diff tab(s)" suffix to a move/rename status line, shared by
                            drag-move and the rename commit above — sprint-047),
                            git-status-index.ts (pure `buildGitStatusLookup(rootPath, changes)` —
                            derives the tree's per-row git tint from `git-store.changes`, which
                            `StatusBar`'s subscription already keeps live, so this costs no extra
                            RPC. Bridges two mismatches: change paths are workspace-relative while
                            tree rows are absolute, and porcelain v2's default `-unormal` collapses
                            a wholly untracked directory into one `dir/` entry, so its descendants
                            need a prefix match. Rolls every change up its ancestor directories —
                            a folder is green only while everything changed beneath it is new,
                            amber if anything under it is edited or deleted — so a collapsed folder
                            still shows that something inside it changed. Also exports
                            `buildIgnoredMatcher(rootPath, ignored)`, the same join +
                            collapsed-directory prefix logic for `git-store.ignored`, which is what
                            ghosts `node_modules/`, `dist/` and friends. NOTE: ignored entries only
                            arrive from a daemon new enough to send `--ignored=traditional` `!`
                            lines — against an older daemon the list is simply empty and only
                            dotfiles ghost, which looks exactly like "ignored folders aren't
                            dimming"), RightSidebar, DiffView,
                            CodeView, MarkdownFileViewer, ImageViewer, VideoViewer,
                            BinaryFallbackViewer, TextViewer, HtmlViewer (sprint-063 — sandboxed
                            iframe preview for `.html`/`.htm`/`.xhtml`; see AGENTS.md § Invariants
                            "HTML preview sandbox"), html-sandbox.ts (`assembleHtmlPreview` +
                            `HTML_SANDBOX_TOKENS`/`HTML_PREVIEW_BLOCKING_CSP` — pure, no React,
                            see the same invariant) (+ test), html-assets.ts (sprint-064 — pure
                            local-asset-inlining core: `extractLocalAssetRefs`/`confineAssetRef`/
                            `confinementRoot`/`rewriteHtmlAssetRefs`/`extractCssUrlRefs`/
                            `rewriteCssUrls`/`dataUri`/`mimeForAssetPath`/`ASSET_LIMITS`/
                            `withinAssetCaps`; the tag/attribute scanner extraction and rewriting
                            share, so they can never disagree on which refs count; see the same
                            invariant) (+ test), html-asset-loader.ts (sprint-064 —
                            `loadHtmlAssetBundle`: the framework-free fetch orchestration over
                            `html-assets.ts`'s pure core — bounded parallelism, caps enforced as
                            bytes arrive, one nested pass into an inlined stylesheet's own
                            `url()` refs; see the same invariant) (+ test), viewer-registry (single
                            `VIEWER_REGISTRY: readonly ViewerDescriptor[]` table — `kind`, lazy
                            `component`, `extensions`, optional `mimePrefixes`, required
                            `liveRefresh` — sprint-063; `VIEWER_BY_KIND`, the extension/MIME
                            lookup tables, and the live-refresh set are all DERIVED from it at
                            module load, not separately maintained; see AGENTS.md § Invariants
                            "Adding a file viewer"),
                            MoleculeViewer (molstar WebGL canvas for structure files, wires
                            `@molviewer/core`'s `onSave` to `write-file.ts` and its
                            `onPolymerBuild` to create-entry + upload), MoleculeViewerPanel
                            (PanelProps adapter, styled via the shared `Panel` primitive plus a
                            local `.wrap`/`.badges` override for its absolute-positioned status
                            badges), molecule-source.ts,
                            write-file.ts (shared `file_write_request` caller + error-code messages,
                            mirrors move-entry.ts — used by MoleculeViewer's Save button),
                            delete-entry.ts (shared `file_delete_request` caller — FileContextMenu's
                            delete action and MoleculeViewer's polymer-build rollback),
                            polymer-file.ts (pure polymer file-name derivation),
                            molecule-reload.ts (pure reload-gate logic), molecule-theme.ts (pi-studio
                            chrome color override), text-viewer-state.ts (pure state selection), + tests
    git/                    ChangesPanel (pure `git-store` consumer — see AGENTS.md § Invariants
                            "Status bar" for why it no longer owns its own checkout-status
                            subscription)
    terminal/               TerminalPanel (one xterm instance per open terminal tab; opening a
                            tab whose `data.slot` is already known — e.g. from
                            `use-terminal-restore.ts` — subscribes to the existing PTY instead of
                            spawning a new one), terminal-size.ts (pure PTY size predicates:
                            `isMeasurable`/`sameGrid`/`shouldClaimSize` — validity + dedupe only;
                            the *permission* gate `isSizeAuthority` lives in TerminalPanel and is
                            deliberately kept separate — see § Invariants "PTY sizing"). No
                            dedicated "Terminals" management view — orphaned terminals reopen
                            automatically as tabs on connect.
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

Build-time brand override (both build:web/build:electron and `npm run dev`, `src/brand/
build-brand.ts` — title + favicon only, unset ⇒ byte-identical default Pi-Studio output):
`PI_STUDIO_BRAND_TITLE` (default "Pi-Studio" — `index.html`'s `<title>` and `ConnectionBar.tsx`'s
brand label) and `PI_STUDIO_BRAND_ICON` (unset ⇒ the default `public/favicon.svg`; a path to a
`.svg`/`.png`/`.ico` file replacing the favicon — an unsupported extension or a missing file fails
the build).

Docker: `docker/web-client.Dockerfile` builds the `build:web` output into an `nginx:alpine` static
image (SPA fallback + optional same-origin `/daemon-ws` proxy set by `PI_STUDIO_DAEMON_UPSTREAM`);
`docker/docker-compose.yml` serves it on `:8080` alongside the daemon/relay. The daemon URL is
entered at runtime, never baked into the image.

Production builds (`build:web`/`build:electron`) set `sourcemap: false` in `vite.config.ts` and run
`vite build` under `NODE_OPTIONS=--max-old-space-size=6144` — the largest vendor chunks (`vendor`,
`vendor-molviewer`) generate 8–18 MB sourcemaps each; with sourcemaps on, Rollup's chunk-rendering
phase blew past the default V8 old-space heap and OOM-killed every `.github/workflows/release.yml`
run from 2026-08-17 onward (`node --max-old-space-size` default is ~2 GB regardless of the runner's
actual RAM). Nothing in this repo consumes `.map` files (no Sentry/error-tracking upload) — they
were ~68% of `dist/web`'s total size for zero benefit. `npm run dev`'s dev-server sourcemaps are
unaffected (Vite's dev transform is separate from this `build.sourcemap` option).

---

## Invariants

- **No raw WebSockets.** All daemon traffic goes through `@av-pi-studio/client`.
- **No Node-only APIs** in renderer code (must run in browser + Electron renderer).
- **Build-time brand override (title + favicon only).** `PI_STUDIO_BRAND_TITLE`/
  `PI_STUDIO_BRAND_ICON` (`src/brand/build-brand.ts`, wired into `vite.config.ts`'s
  `brandHtmlPlugin`) rewrite `index.html`'s `<title>`/favicon `<link>` and bake
  `ConnectionBar.tsx`'s brand label via the `__BRAND_TITLE__` define, in both `npm run dev` and
  every build target. Both are optional and independent — unset ⇒ byte-identical default
  Pi-Studio output. This is intentionally narrower than `src/brand/config.ts`'s `BrandConfig`
  scaffold (accent colors + logo triplet + links/legal, ported from `swe/features/
white-label-branding.md`'s clean-room spec): that scaffold has no build-time loader wired to it
  (`getActiveBrand()` always returns `DEFAULT_BRAND`) and is out of scope until a colors/logo
  override is actually requested — do not conflate the two or wire one through the other.
- **Never call `crypto.randomUUID()` directly.** It requires a secure context, which plain-http
  LAN access to a self-hosted daemon (`pi-studio ui`'s documented deployment mode) does not
  satisfy — `crypto.randomUUID` is `undefined` there, throwing `TypeError: crypto.randomUUID is
not a function` (real regression: pane-id minting, chat's optimistic-echo `clientMessageId`,
  and Mermaid block DOM ids all hit this). Use `lib/random-id.ts`'s `randomId()` instead, which
  prefers `crypto.getRandomValues` (no secure-context requirement) and falls back further only
  if `crypto` itself is absent. Mirrors `lib/clipboard.ts`'s `navigator.clipboard` fallback and
  `@av-pi-studio/client`'s own `randomId()` (a separate copy — this package intentionally does
  not import client's, to keep this pure-`lib/` module free of a cross-package runtime/build
  dependency for a one-line vitest-collected pure helper).
- **`statusSuccess`, never `success`, for green signals.** `theme/colors.ts`'s `buildDarkColors`
  aliases `success` to the accent color on dark variants, so a `success`-tinted element is
  indistinguishable from an accent-tinted one there.
- **`accentForeground`, never a hardcoded white, for content on an accent fill.** The `zinc`
  variant's accent is near-white, so white text/icons on it are invisible.
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
- **Connection resume triggers (sprint-050).** `lib/connection/resume-triggers.ts`'s
  `attachResumeTriggers()` is installed once, at module scope in `main.tsx` (never inside a React
  effect — `<StrictMode>` double-invokes dev effects, which would attach two listener sets). It
  reacts to `visibilitychange` (`hidden → visible` only) and `online`, reading
  `useConnectionStore.getState()` fresh at signal time (never captured — the store replaces
  `daemon`/`reconnection` on every `connect()`), and feeds `lib/connection/resume-action.ts`'s
  pure `resolveResumeAction({ status, managerActive, probeInFlight })`: `closed` + an active
  `ReconnectionManager` → `reconnection.reconnectNow()` (bypasses the pending backoff delay);
  `open` + active + no probe already in flight → a liveness probe, `daemon.ping(PROBE_TIMEOUT_MS)`
  (`PROBE_TIMEOUT_MS = 5_000`, tighter than `ping()`'s 10 s default — the daemon answers from its
  socket read loop, so 5 s of silence on a working link is already pathological); on rejection,
  after an identity check (`store.daemon === <the probed instance>`, guarding a disconnect/
  reconnect racing the probe), `daemon.close(4000, "stale-connection-probe")` — the resulting
  `closed` transition hands off to the active `ReconnectionManager`'s own rung-1 retry; the probe
  branch **never** calls `reconnectNow()` itself (`close()` sets `closing` synchronously, so a
  same-tick call would always no-op on `reconnectNow()`'s `state === "closed"` guard — that would
  be dead code implying an immediacy that doesn't exist). `managerActive: false` (the user clicked
  Disconnect, or never connected) short-circuits every row to `none` — **no resume signal ever
  resurrects an explicit disconnect.** `reconnection.ts`'s Worker-backed timers
  (`lib/connection/worker-timers.ts`'s `createWorkerTimers()`, injected at `connection-store.ts`'s
  single `new ReconnectionManager(daemon, …)` call site) keep the backoff ladder's scheduled
  retries accurate in a hidden/throttled tab; `resume-triggers.ts` is the complementary path for
  the moment the user actually returns. Close code `4000` is in the WebSocket private-use range —
  it appears only in logs, no wire meaning.
- **Zero agents on connect ⇒ no workspace, not a phantom one.** `use-session-restore.ts` only ever
  restores from `list_agents_request`'s results — if the daemon reports zero agents, the hook
  returns without touching `tab-store`/`ui-store` at all: no session or chat tab is created, and
  `activeWorkspaceCwd` stays `null` unless the persisted pane layout reopened a client-side tab
  (`reopen-client-tabs.ts` — a workspace the user had files open in does come back into view, which
  is the point of persisting it). (It previously called `openNewChat` in this case, materializing a
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
- **Panel continuity across pane rearrangement.** `TabPanelHost` mounts each open tab's panel
  **exactly once** and positions it absolutely at its pane's fractional rect — the pane tree is
  rendered as a flat list of rects, never as nested React containers per split. Splitting, dragging a
  tab between panes, resizing, and collapsing a pane therefore only change a panel's `style`, so a
  terminal keeps its PTY and a chat keeps its stream subscription. NEVER render panels inside a
  recursive pane component: React would unmount and remount them on every rearrangement, killing the
  terminal and re-subscribing the chat.
- **PTY sizing: permission and knowledge are separate, and neither is focus.** `TerminalPanel` sends
  a `Resize` frame from exactly one seam (`claimSize`) behind two independent gates.
  `isSizeAuthority(tabId)` is **permission** — is this panel visibly rendering (active workspace, its
  pane's active tab)? `shouldClaimSize(next, believed)` (`terminal-size.ts`) is **knowledge** —
  validity plus dedupe against `believedSizeRef`, what we think the PTY currently is, seeded from
  `create_terminal_request`/`subscribe_terminal_request`'s echo.
  - NEVER gate a resize on pane focus or DOM focus. Focus is who receives keystrokes; it says nothing
    about whether a rendered grid is real. Splitting with a non-terminal tab, switching workspaces,
    and session restore each move focus away from a terminal that is still visibly on screen — gating
    on focus stranded those at the wrong width (garbled text, background color stopping short of the
    rendered columns).
  - NEVER treat "this client has never sent a size" (`believedSizeRef === null`) as "not allowed to
    send one". That is the normal state of every **restored** terminal, whose PTY predates the client;
    conflating the two made restored terminals ignore divider drags and window resizes for their
    entire life. An unknown belief counts as _differing_, because that PTY is usually still at its
    80×24 spawn default.
  - A `fit()` that lands on an unchanged grid emits no `onResize`, so `performRefit` reconciles
    explicitly after fitting — a panel that measured 0×0 while hidden would otherwise become visible
    and stay silent.
  - Attach-time sizing goes in the `subscribe_terminal_request` **payload**, not a frame sent after
    it resolves: the daemon emits the `Snapshot` synchronously, so a later frame cannot stop a
    full-screen app's paint from being replayed at the wrong width.
  - Every reconcile point (post-fit, on focus, post-attach) goes through the one `measureAndClaim()`
    helper. Don't re-inline `proposeDimensions()` + `isMeasurable` + claim at a new call site; that
    trio drifted across three copies once already.
  - Guard the daemon's echo with `isMeasurable` before seeding `believedSizeRef`. An older daemon may
    omit `cols`/`rows`, and a `{cols: undefined}` belief matches no real measurement, so every later
    fit would re-send a resize the PTY already has. `null` ("unknown") is handled everywhere; a
    half-populated grid is not.
  - The pre-slot input queue is bounded in **bytes** (`MAX_PENDING_INPUT_BYTES`), not chunks: one
    `onData` chunk is a whole paste, so a chunk-count cap bounds nothing useful.
- **`tab-store.activeTabId` is derived, and per-pane visibility is a different question.**
  `layout-store` owns all pane state, including the focused pane and each pane's active tab;
  `activeTabId` is a cached projection written **only** by `syncActiveFromLayout()`. It is driven from
  two places: this store's own lifecycle methods, and a **module-scope `layout-store` subscription** at
  the bottom of `tab-store.ts` that re-projects whenever the focused pane's active tab changes. That
  subscription is not optional bookkeeping — clicking into another pane calls `layout-store.focusPane`
  directly (`TabStrip`/`TabPanelHost` `onPointerDown`), so without it `activeTabId` and
  `session-store.activeSessionId` kept naming the _previously_ focused pane's chat and the status bar
  showed the wrong conversation's model, context, tokens and cost. Any new focus path (drag commit,
  keyboard pane navigation, close fallback) is covered by the same subscription; it bails unless the
  projected id actually changed, so a divider drag's per-frame mutations stay free.
  With splits, "is this tab visible?" is no longer `tab.id === activeTabId` — every pane's
  active tab is visible. Panels MUST use `useIsTabVisible(tabId)` (over `layout-store`'s
  `isPaneActiveTab`) for mount/visibility decisions, and reserve `activeTabId` for genuinely
  workspace-scoped things (the shortcut target, the status bar's subject — which now follows the
  focused pane, the same way an editor's status bar follows the active editor).
- **A restored tab finds its pane by identity, not by tab id, and only claims survive a reload.**
  Panes persist; tabs do not. `usePaneLayoutBoot` installs the record as _pending claims_ keyed by
  `tabIdentity`, each restore source (`runSessionRestore`, `runTerminalRestore`) reports in a
  `finally`, and at that settle point unconsumed claims are dropped and unclaimed panes pruned — so
  restore is order-independent and a daemon that no longer has an agent/terminal cannot leave a
  permanently empty pane behind. This is why a chat's identity is its **daemon-side agent id**
  (`agent:<agentId>`), never its client-local session id, which is re-minted on every load; a draft
  whose `createAgent` has not landed has no identity and is deliberately unrestorable.
- **An unclaimed restore-time arrival must never steal an already-occupied pane.** The two restore
  hooks race in undefined order, so a terminal or chat with no claim for it can arrive _after_ a claim
  has already placed something else in the very pane it would otherwise land in (default routing: the
  focused pane). `layout-store.ts`'s `claimPaneFor` tracks this with an explicit `restoring` flag —
  `true` from `installPersistedLayouts` until `markHydrationSource` settles — and while it holds, an
  unclaimed arrival only takes over a pane whose `activeByPane` slot is still empty; it is still
  placed (an orphaned terminal must not leak silently), just not activated or focused over a claim.
  After the settle point this restriction lifts entirely — a live "+"/Ctrl+T open into the focused
  pane taking it over immediately is the correct, ordinary behaviour. The two hook-level fallbacks
  that used to force a tab open regardless of any claim — `use-session-restore.ts`'s "open the most
  recent chat" default and `use-terminal-restore.ts`'s "reopen every running terminal" default — are
  now scoped to the arrival's **own** workspace having no persisted layout entry at all; a persisted
  record for some _other_ workspace must never suppress or clobber one that genuinely has none.
- **Restore seeds per-workspace facts from the workspace that was IN VIEW, never from the newest agent.**
  `use-session-restore` used to derive the sidebar's expanded group, the file-explorer root and the
  active conversation from `order[0]` — the globally most-recently-active agent — because that predated
  the layout record knowing which workspace the user was actually looking at. With two workspaces open
  that reads as "my layout was lost": the panes come back correctly in workspace A while the sidebar
  sits expanded on B. `pendingActiveWorkspace` (captured by `installPersistedLayouts` at boot, cleared
  at the settle point) is that fact, and it must be **captured, not re-read**: `writePaneLayout`
  persists `activeWorkspaceCwd` from whatever is in view _at write time_, and writes fire throughout
  the restore window, so a later read can get an already-clobbered target. Two things stay keyed on
  the newest agent on purpose: the task-011 fallback-tab rule (which asks whether _that agent's own_
  workspace has a record — rekeying it on the view target would stop opening it whenever some other
  workspace had been split), and the seed's own fallback when nothing was persisted.
  The active conversation cannot be fixed by seeding alone — every `open()` brings its own workspace
  into view and re-activates its own chat, so any pre-tab seed is overwritten. `switchWorkspace` at the
  settle point syncs it from the focused pane, but `syncActiveSession` deliberately no-ops for a
  terminal/file tab (a terminal has no conversation; blanking the status bar would be worse), which
  would leave a _foreign_ workspace's chat active. `restore-active-workspace.ts` therefore adopts a
  chat from the restored workspace as its last step — including when the view was already correct,
  since that says nothing about which conversation is active.
- **Who reopens a tab depends on who owns it.** Daemon-owned kinds come back from the daemon's
  connect-time inventory: chats from `list_agents_request`, terminals from the terminal listing, and
  one deleted since the last load correctly stays gone. `file`/`diff`/`molecule` tabs have no
  daemon-side existence — they are views of a path — so `features/workspace/reopen-client-tabs.ts`
  replays them from the record, gated on the connection reporting `open` (nothing restores UI behind
  the connect form, even though the replay itself needs no RPC), because the persisted **identity is
  already the descriptor** (`file:<path>`, `diff:<staged|worktree>:<path>`, `molecule:<path>`) and
  needs no extra state. `tabFromIdentity` MUST stay the exact inverse of `tabIdentity`: it deliberately
  does not call `openFileTab`, which _dispatches_ on extension and would turn a persisted
  `file:/a/x.cif` into a `molecule` tab, orphan the claim, and prune the pane. Unknown prefixes are
  ignored, never guessed — a record written by a newer client may name kinds this one has never heard of.
- **Two drag systems coexist on purpose, split by where the gesture STARTS.** A drag beginning on a tab
  already in a strip is dnd-kit (`use-pane-drag.ts`, one `DndContext` owned by `TabPanelHost`); a drag
  beginning on a sidebar row — a session in the list, a file in the Files tree — is native HTML5 DnD
  (`use-external-pane-drop.ts`). This is forced, not stylistic: dnd-kit cannot receive an OS file drop,
  because `dataTransfer.files` exists only in native DnD, so the Files tree must stay a native drag
  source and target for uploads and row-to-row moves regardless. Arming dnd-kit on those same rows
  would start two gestures at once. The two cannot collide — a native `dragstart` suppresses the
  pointer events dnd-kit's `PointerSensor` activates on — so `TabPanelHost` renders ONE preview from
  whichever is live. Both resolve their region through `pane-dnd.effectiveDropRegion`, so "the preview
  is always the outcome" holds across both. A native drag reads a pane's body box by **measuring** the
  `data-pane-drop` zones rather than recomputing it: the box is a percentage rect minus
  `var(--pane-strip-height)`, and the DOM is the only place those are already combined. Its listeners
  sit on the host, not the zones, because the zones are `pointer-events: none` (they must not swallow
  clicks into the panel beneath). Mid-drag a browser exposes `dataTransfer.types` but not the values,
  so the _MIME name_ carries the kind and the payload is read at `drop` — which is also why a row
  outside the workspace in view withholds its MIME entirely instead of being refused at drop time: a
  pane could not tell it apart in time to suppress the preview.
- **An iframe must never hit-test during a drag.** An `<iframe>` is a separate document that
  hit-tests independently: while the pointer is over one, the parent document receives neither
  `pointermove` (dnd-kit's `PointerSensor` listens on the owner document and its bundle calls
  `setPointerCapture` nowhere) nor `dragover`/`drop` (native DnD dispatches into the frame's own
  document). Both drag systems above therefore went silent the moment a tab or file crossed into
  `HtmlViewer`'s preview, stranding the drag over the very pane it was aimed at. `lib/drag-guard.ts`
  removes every iframe from hit-testing for the duration of a drag, via a `<body>` attribute plus one
  `global.css` rule — deliberately NOT React state: it costs no re-render mid-gesture and never
  re-sets the iframe's `srcDoc`, which would reload the previewed document and re-run its scripts
  (see § "HTML preview sandbox"). Arm it from any new drag system, and never make a viewer's own
  component responsible for it — the guard is viewer-agnostic on purpose, so a future embedded frame
  needs no new wiring. Note this is a DIFFERENT mechanism from the divider/sidebar-handle fix below,
  because neither dnd-kit nor native DnD exposes pointer capture to us.
- **A pointer-driven resize drag must capture its pointer.** `PaneDividers.tsx` and
  `primitives/ResizeHandle.tsx` own their gesture directly, so they take the sharper fix: an explicit
  `setPointerCapture(ev.pointerId)` on the handle at `pointerdown`. Without it the same iframe
  swallowed the `pointermove`s _and_ the terminating `pointerup`, so a divider dragged across an HTML
  preview stuck mid-resize and never released — leaving the move/up listeners, `col-resize` cursor and
  `user-select: none` installed. Chrome grants _implicit_ capture for touch only, never for mouse,
  which is why this only ever reproduced with a mouse. Capture retargets dispatch to the handle, from
  which events still bubble to the existing `window` listeners, so no listener restructuring is needed;
  both also clean up on `pointercancel` and release via a `hasPointerCapture` guard.
- **A pane-layout write must never drop a claim that has not been consumed yet.**
  `writePaneLayout` is otherwise a projection of _live_ tabs, and writes fire throughout the restore
  window — the client-side replay causes one immediately. Seeding `placement`/`activeByPane` from
  `pendingPlacement`/`pendingActive` and layering live tabs on top is what keeps a still-in-flight
  chat's pane in the record; without it the next load has geometry with no claims and the settle point
  prunes those panes, so the split collapses one reload later with nothing to point at. Post-settle the
  pending sets are empty and this reduces to the plain live projection — see the two regression tests
  in `pane-layout-persistence.test.ts` ("keeps unconsumed claims…", "drops a claim once hydration
  settles…").
- **Which workspace is in view is persisted state, restored at the settle point.** Pane geometry is
  per workspace, so restoring geometry alone leaves the view to whoever opens the last tab — in
  practice `use-session-restore`'s `order[0]`, i.e. the most recently active _agent_, which with two
  workspaces open is a coin flip. `restore-active-workspace.ts` switches back to the persisted
  `activeWorkspaceCwd` when hydration settles: earlier is pointless (every `open()` brings its own
  workspace into view and would overwrite it), it is **one-shot** so a user who switches during
  restore is never yanked back, and it is skipped when that workspace has no restored tab (landing on
  an empty workspace is worse than staying put). Symptom when this is missing: "my layout was lost" —
  the panes are all there, one workspace over.
- **Restored history is paged to completion, never a single fetch.** `fetch_agent_timeline_request`
  is bounded — the daemon returns at most `limit` projected items (server default 200,
  `timeline-store.ts` `DEFAULT_PAGE_SIZE`) and sets `hasNewer:true` when rows remain past the page;
  the contract (`timeline-rpc.ts`) is that clients keep fetching until `hasNewer:false`. So
  `use-session-restore.ts` drives `lib/protocol/timeline-paging.ts`'s `fetchTimelineEvents`, which
  refetches from each page's `endCursor` and concatenates. A single `direction:"after"` fetch
  returns the OLDEST page only: it silently truncated every conversation longer than the cap, so
  restored history stopped partway and the newest messages were missing (while the agent itself
  still remembered them — the daemon's timeline, rehydrated from Pi's session file, was complete).
  Paging stops on `hasNewer:false`, an empty page, or a cursor that fails to advance; never add a
  page cap, which would reintroduce silent truncation.
- **Markdown renders live while a row streams, block by block — never by re-parsing the whole
  message per token delta.** The daemon emits one `assistant_message`/`reasoning` event per Pi
  `text_delta` (no coalescing anywhere in between), so the streaming row re-renders once per token.
  A full parse through react-markdown + remark-gfm + remark-math + rehype-katex measures ~1.3ms at
  213B, ~9ms at 3.5KB and ~27ms at 10KB — several frame budgets per token — which is why the row
  used to stream as plain text and only swap to `<Markdown>` at block close. `StreamingMarkdown`
  (`timeline/markdown.tsx`) instead splits the text with `timeline/streaming-split.ts`: every block
  the model has finished is its own memoized `MarkdownBody` (parsed exactly once for the turn) and
  only the block still being written re-parses per delta (~0.24ms). The tail additionally renders
  `lean` — no Shiki, no mermaid, no KaTeX — since those would re-tokenize a half-open fence, re-lay
  out a half-written diagram, and flash red parse errors on a half-typed `$…$` on every token; each
  fires exactly once, when its block closes and moves into the immutable half. Never widen the
  split's boundary rules for convenience: a wrong cut is a visible mid-stream artifact (its header
  documents why a blank line inside a fence or before an indented list continuation is not a
  boundary), and `blocks` must stay append-only because `StreamingMarkdown` keys on the index.
- **A row's `streaming` flag must never outlive the block it describes.** It selects
  `StreamingMarkdown` (split render + caret) over `Markdown` (one canonical parse of the whole
  text) in `AssistantRow`/`ReasoningRow`, so a stranded flag leaves a finished message rendering
  through the streaming path — with a blinking caret, a lean tail, and no KaTeX on its last block —
  forever. `reducer.ts` therefore clears it the moment the row can no longer grow: on
  `assistant_message.final`/`reasoning.final` (the daemon's mapping of Pi's `text_end`/
  `thinking_end`), on the next `tool_call`, on an assistant↔reasoning switch, and on any turn
  boundary. `finalizeRow`/`finalizeStreamingRows` are the single implementation — use them rather
  than nulling `streamingAssistantIndex`/`streamingReasoningIndex` by hand. Clearing the _index_
  alone (what `onToolCall` used to do) strands the row: `turn_completed` only finalizes the index
  it still holds, so every message followed by a tool call rendered as raw markdown source
  forever, including after a reload — `use-session-restore.ts` replays through this same reducer.
  Note the deliberate exception: `user_message` does **not** finalize, because a steering message
  arrives mid-block and splitting there would tear one reply into two bubbles.
- **`theme/tokens.ts`'s `baseFontSize` is the ONE lever for the app's text size — no CSS module
  ever hardcodes a `font-size` literal, and there is no root-level percentage multiplier.** Every
  `font-size` in the app is `var(--pi-font-size-<rung>)` with no fallback value; `theme/
css-bridge.ts`'s `pxToRem()` emits each rung as `rem` against the untouched 16px root, so text
  also tracks the user's own browser/OS zoom. `ThemeBoundary` applies the vars synchronously
  during first render, before paint, which is why the fallbacks are gone: a `var(--x, 13px)`
  fallback is a second, silently-stale copy of the scale (`markdown.module.css` shipped mistyped
  var names for months, quietly rendering its hardcoded fallbacks instead). `ui/button.ts`'s
  `BUTTON_FONT_SIZE` holds `var(…)` references too; only `TerminalPanel.tsx`'s xterm config reads
  a raw number (`baseFontSize.sm`), because xterm rasterises to canvas and cannot take a CSS var.
  `theme/font-scale.test.ts` enforces both halves — every referenced rung exists, and no CSS
  module reintroduces a px/rem literal (relative `em`/`%` is fine).
  The rungs are a dense, mostly 1px-step ladder (`4xs`→`4xl` plus `code`) matching what the UI
  actually renders; `base` is the document base, and `theme/theme.ts`'s `FONT_SIZE_BASE` is
  derived from it (`baseFontSize.base`, not a literal) because the Appearance `fontSize` setting
  scales the whole table by `clamp(10..24)/FONT_SIZE_BASE` and silently miscalibrates if the two
  drift apart — which they did the first time `base` was retuned. `applyAppearance` likewise
  derives its key list from `Object.keys(baseFontSize)`, so adding a rung needs no edit there.
  History worth not repeating: the original scale read too small; a fix converted px→rem _and_
  enlarged everything ~1.25x in one commit, which overshot; that enlargement was rolled back, and
  the scale then settled at ~1.06x over the original (`4xs`=10 … `base`=17) via ~1.125x. Each of
  those passes before the rewiring was a 77-line shotgun edit purely because the literals were
  unwired; retuning now means editing the one table. An even earlier attempt used
  `html { font-size: 125% }`; don't reintroduce a root-percentage override, since px paddings /
  icon sizes / row heights don't grow with it and it duplicates the scale with a second lever.
  For per-user sizing, point people at the Appearance setting rather than editing the table.
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
- **Files tree root row.** The workspace cwd is the tree's own first row (`file-tree.ts`'s
  `flattenTree` emits it; children start at depth 1), and it is collapsible — `explorer-store`'s
  `toggle` used to hard-refuse the root and `setRoot` used to force-add it to `expanded`; both
  guards are gone, so `setRoot` now seeds a _never-visited_ root expanded but restores a
  remembered set verbatim, letting a deliberately collapsed root survive a workspace switch. The
  row is deliberately special-cased at the `TreeNode` callsite in three ways, all of which would
  otherwise misfire on nearly every workspace: no git tint (the root inherits the status of
  anything changed beneath it, so it would be permanently lit), no dotfile/gitignored ghosting,
  and `draggable={false}` (every legal drop target lives _inside_ the root, so a root drag can
  only ever be refused). Its context menu is the **background** variant — New File / New Folder /
  Copy path, never Rename/Delete.
- **Tree row identity is `file-tree.ts`'s `rowKey`, NEVER `row.path`.** A `loading`/`error` row
  carries its _directory's_ path, so an expanded-but-unsettled directory emits two rows sharing
  one path. Before the root row existed that pair only appeared mid-tree and rarely collided
  visibly; now it is on screen during every workspace's first paint (root row + its own loading
  row). Feeding duplicate keys to `@tanstack/react-virtual`'s `getItemKey` makes React orphan one
  of the two nodes rather than replace it — the symptom is ghost text stacked on the root folder
  name that only clears on hover. `rowKey` prefixes the row kind; `file-tree.test.ts`'s `rowKey`
  suite pins uniqueness across every kind rendered at once. `row.path` remains the right key for
  _semantic_ comparisons (drop target, active file) — that is why `DraftRow.path` stays synthetic.
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
  _entire_ turn (`AgentService.runTurn` doesn't resolve until the turn ends), so a single shared
  flag left the Steer button disabled for the whole turn — the button's `disabled` is keyed off
  whichever flag matches the currently-rendered action (`running ? steering : sending`). All three
  actions are icon-only circular buttons in the composer toolbar (see next bullet): Send is
  `ArrowUp`, Steer is `Navigation`, Stop is a `destructive` `Square` rendered _beside_ the primary
  action while running, never replacing it.
- **Composer layout: one card, one bottom toolbar.** `Composer.tsx` renders a bordered `.card`
  (`Composer.module.css`) holding the autosizing textarea, the `Attachments` strip, and a
  `.toolbar` row along the bottom edge: attach (`+`) and slash-commands (`/`) on the left, model
  picker + Stop/Send-or-Steer on the right (`.toolbarRight`, `margin-left: auto`). Three things
  here are load-bearing and easy to break:
  - **The textarea keeps a 1px TRANSPARENT border, never `border: none`.** `.highlightLayer`
    (the slash-command chip mirror) is absolutely positioned over the same box and mirrors the
    textarea's `padding` + `1px` border exactly; dropping the border shifts every glyph by 1px
    and the chip drifts off the text. The card, not the textarea, paints the visible surface and
    border — hence `.card .textarea { background: transparent; border-color: transparent }`,
    parented on `.card` purely to outrank `TextInput.module.css`'s `.input`/`.input:focus`.
  - **The accent focus ring is `.card:has(.textarea:focus)`, NOT `:focus-within`.** The toolbar's
    buttons live inside the card, so `:focus-within` lights the whole input up accent-blue merely
    because the model menu or attach button took focus.
  - **Circular buttons override `.btn`'s radius through `.card .roundBtn`, not `!important`** —
    CSS-module file order across chunks isn't guaranteed, so a bare `.roundBtn` rule ties with
    `Button.module.css`'s own single-class `.btn` rule and may lose.
- **Extension UI dialogs (sprint-068).** `features/agent-ui/` renders every `agent_ui_request`
  dialog (`select`/`confirm`/`input`/`editor`, plus an unrecognised-method fallback) inline in the
  transcript, through pending, in-flight, resolved-collapsed, non-answerable, and multi-pending
  states, with full keyboard/focus ownership. It is composed into `Timeline.tsx`'s virtualized list
  at render time from `agent-ui-store.ts`'s live SDK state — never a persisted `TimelineRow`, never
  written to `session.timeline.rows`.
  - **State ownership stops at lifetime management.** `agent-ui-store.ts` creates/disposes exactly
    one app-scoped `AgentUiController` (`@av-pi-studio/client`, sprint-067) per connected client —
    lazily, only once the connection is `"open"` and `client.extensionUiAvailable()` is true at
    that moment (never eagerly at client-assignment, which would race the handshake). If capability
    is never present for a client, no controller is ever created — not merely inert, genuinely
    absent. A controller is never torn down for an in-connection blip (its own disconnected/resync
    handling covers that); disposal happens only when `client` itself changes.
  - **Two effects are deliberately unwired.** The controller's `notify` and `replace_composer_text`
    effects are emitted but ignored here — nothing toasts a `notify`, nothing writes into the
    composer. `setStatus`/`setWidget`/`setTitle` (retained surfaces) have no consumer either; no
    `useAgentUiSurfaces` hook is exposed. This is the status quo, not an oversight — sprint-069/070
    are the ones that wire them. Do not add a second, divergent consumer of the SDK's surface state
    ahead of that design.
  - **No optimistic update, anywhere.** Submitting a response fires `respondToUi` and nothing
    else — a card stays pending until the daemon's `agent_ui_resolved` arrives. `submitting`/
    `submittedAnswer`/`answerable` are read straight off `AgentUiPendingEntry`; `AskCard.tsx`
    decides nothing new about resolution state.
  - **Keyboard/focus ownership is CSS-first, not listener-first.** A card's amber border/ring and
    its hint line's visibility are pure `.card:focus-within` CSS — no focus/blur JS drives them.
    This is the opposite choice from `Composer.tsx`'s own `.card:has(.textarea:focus)` (`:focus-
    within` there would wrongly light up when the toolbar's model-picker/attach buttons take
    focus) — deliberately different, because a card's dismissing/primary CONTROLS being focused is
    exactly what "this card owns keys" should mean, unlike the composer's toolbar. The one real
    state is `armed` (`keyboard.ts`'s `pressEscape`) — the two-step Esc's hint text has to change,
    which CSS cannot do. Enter never needs a global handler either: `Composer.tsx`'s Enter-submit is
    scoped to its own `<textarea onKeyDown>`, a disjoint DOM subtree from any card, so neither can
    ever see the other's Enter keypress. Esc is the one key with an ambient listener
    (`use-shortcuts.ts`'s `document`-level handler) — every Esc a card handles calls
    `stopPropagation()`. A card's second-Esc resolution calls `.click()` on its own dismissing
    control (Cancel/No/Block) rather than resolving with an invented payload, so a keyboard
    dismissal is byte-for-byte the same outcome as a mouse click on that same control — see
    `AskCard.tsx`'s `PendingAskCard` for why this matters (`confirm`'s outcome line only reads
    "declined" from `answer.confirmed === false`, not from a bare cancellation flag).
  - **Ordering never re-derives, it re-sorts by the SDK's own key.** `ask-list.ts`'s
    `mergeAskEntries` unions pending + resolved and sorts by `pendingForAgent`/`resolvedForAgent`'s
    own `compareByTimeThenId` — the same comparator both source lists already use — so a card's
    slot never moves when it resolves. Never invent a second, local ordering here.
  - **Cards are placed chronologically among the rows, not appended after them.**
    `ask-placement.ts` merges the ask layout into `Timeline.tsx`'s row list by comparing a card's
    `createdAt` against row timestamps, so a card sits next to the tool call that raised it rather
    than trailing the whole transcript. Tasks 005–007 appended unconditionally, which is
    indistinguishable from correct under the mock provider (every `#ui` recipe ends the turn on the
    dialog) but renders an answered question *below* the reply that consumed it on any real
    extension turn that continues past resolution. Two rules are load-bearing and must not be
    "simplified" into a sort: **rows never move relative to each other** (their array order is
    daemon append order, and `timestamp` is optional on every row kind — one `undefined` makes a
    comparator inconsistent and scrambles the transcript), and a card with no usable time, or with
    no row provably newer than it, **degrades to trailing** — the old behaviour, never index 0.
    `ToolRow`/`ErrorRow`/`SystemRow` carry `timestamp` for exactly this; the tool row is stamped at
    the call's **start** and never on a status upsert, or it would overtake the dialogs it spawned.
  - **Not built this sprint:** the sidebar/tab/workspace attention signals (§ 08 of the visual
    spec — StatusDot/SessionRow/TabStrip pulse, row tint, collapsed-header dot; sprint-069),
    `setWidget`/`setStatus`/`setTitle` rendering (§ 09/§ 10; sprint-070), `notify` toasts (§ 11),
    and `set_editor_text` (§ 11). None of the wiring for those exists yet — this sprint is
    dialogs only.
- **Molecule viewer tabs and live file watching.** The new `TabKind` "molecule" holds
  `MoleculeTabData { path: string | null }` — a `null` path is an empty ("+"-menu) tab showing
  molviewer's own drag-drop UI (`FirstRunCard`). The dispatch from file-to-molecule happens at
  **tab-open time** in `open-file-tab.ts`'s `openFileTab` via `isMoleculeFile(path)`
  (`viewer-registry.ts`) — NOT inside `FilePanel` or as a new `ViewerKind` entry. Either side is
  overridable per open from the row context menu ("Open in MolViewer" / "Open as Text"), and both
  tabs may be open on one path at once — `tabIds.file` (`file-<path>`) and `tabIds.molecule`
  (`mol-<path>`) are separate id namespaces, which is also why `tabFromIdentity` must not
  re-dispatch (see § Invariants "Who reopens a tab"). Supported
  formats: `MOLECULE_EXTENSIONS` (pdb, mol, mol2, cif, mmcif, xyz, extxyz, gro, lammpstrj, xsf —
  10 formats) + `MOLECULE_FILENAMES` (poscar, contcar — extension-less, matched by basename);
  LAMMPS `data` files are deliberately excluded (no fixed extension, would require async
  content-sniffing). `openNewMolecule(workspaceCwd)` (tab-store.ts) mints a new empty tab,
  numbered off a module-level `moleculeCount` counter. `MoleculeViewerPanel.tsx` is the thin
  `PanelProps` adapter; the actual viewer is `MoleculeViewer.tsx` (`@molviewer/core`'s
  `<MolViewer>` component, imported at module scope to enable CSS import), with live reload
  (`useFileWatch` on `path`, triggering `download.refetch()` when file changes, gated by unsaved
  in-viewer edits via `shouldApplyRefresh` in `molecule-reload.ts`). The `vite.config.ts`
  `manualChunks` rule isolates `@molviewer/core` + `molstar` into a `vendor-molviewer` chunk
  (~3.25 MB JS + CSS) absent from the initial page load — fetched only when a molecule tab first
  renders (lazy import via `panel-registry.ts`). `theme={MOLVIEWER_THEME}` (`molecule-theme.ts`)
  remaps molviewer's base panel background (`--canvas`/`--well`/`--recess`/`--chrome`), its
  button/control surfaces (`--control`/`--control-hover`/`--control-strong-hover`,
  `--border-control`/`--border-input`), its dropdown/menu surfaces
  (`--popover`/`--popover-item-hover`/`--row-hover`/`--border-popover`), and primary text
  (`--text-primary`/`--text-on-control`) CSS vars to `var(--pi-color-*)` references so its chrome
  blends into pi-studio's shell and tracks live theme/appearance changes via ordinary CSS
  cascade — deliberately narrow scope, mapping only onto pi-studio tokens that already have a
  direct equivalent and leaving molviewer's own accent/selection/danger/success/warning colors
  and muted-text scale untouched. This is chrome-only: `initialView.backgroundColor` (the WebGL
  scene's clear color) and `colorScheme` (per-atom coloring) are separate props, neither touched
  here. `@molviewer/core` is declared in this package's own `package.json` (not root).
- **`MolViewer`'s `source` prop is a load TRIGGER keyed on object IDENTITY — never hand it a fresh
  literal.** `@molviewer/core`'s `MolViewer.tsx` loads via `useEffect(…, [source])`, documented
  there as "loaded whenever this value's identity changes", and an `update`-mode load re-parses the
  file and dispatches `UPDATE_SYSTEM`, replacing the structure and silently discarding every
  in-viewer edit (camera/selection/status survive, which is why it reads as a revert rather than a
  reload). `MoleculeViewer.tsx` MUST therefore memoize it —
  `useMemo(() => moleculeSource(path, objectUrl), [path, objectUrl])` — so identity changes only
  when the bytes do, i.e. when `download.refetch()` mints a new object URL, which is exactly what
  live reload needs. Calling `moleculeSource(...)` inline during render instead made the **first**
  atom delete or move after every load and every save undo itself: the edit flips `modified`,
  `onModifiedChange` → `setModified` re-renders, the new `source` identity reloads the file, and the
  atom reappears a frame later. Later edits stuck (already dirty ⇒ no `modified` transition ⇒ no
  re-render), which is what made it read as random rather than as a bug with a period. Any
  unrelated re-render did it too, and since `TabPanelHost` re-renders every panel on every layout
  mutation, a divider drag reloaded the structure once per `pointermove` frame — presenting as the
  viewer's own mouse/keyboard input "not registering".
- **Molecule viewer save (`onSave`, `@molviewer/core` 0.4.3+).** `MoleculeViewer.tsx` passes
  `onSave` to `<MolViewer>` only when the tab is file-backed (`path` non-null — the empty
  "+"-menu tab has nowhere to write and gets no Save button at all, since passing the prop is
  what draws it). The handler writes `e.text()` (the viewer's own current-frame serialization)
  straight back to the absolute `path` already in scope via `write-file.ts`'s `file_write_request`
  caller — NOT `e.fileName`, which is only molviewer's load-time basename (`moleculeSource`'s
  `name`, no directory) and unusable as a write target. `e.saved()` is called only after the
  daemon confirms the write; that is what greys the button out and flips `onModifiedChange` back
  to clean. A failed write (`saveError` state, rendered as an `error`-variant `StatusBadge`
  alongside the existing "File changed on disk" one, both inside a shared `.badges` absolute
  corner stack) deliberately does NOT call `e.saved()`, so the structure stays marked dirty and
  the button stays live for a retry — matches `write-file.ts`'s daemon error codes (`not_found`,
  `too_large`, `not_a_file`, …), all overwrite-only: the daemon 404s a missing target rather than
  creating one. `packages/server/src/files/file-explorer.ts`'s `file_write_request` handler is
  unvalidated (no protocol-package schema entry), matching every other file RPC in this surface —
  see root AGENTS.md's per-path-subscription passthrough convention.
- **Molecule viewer polymer build (`onPolymerBuild`, `@molviewer/core` 0.4.4+).** File-backed tabs
  only, same `path`-non-null gate as `onSave` — but the consequence is the opposite: omitting
  `onSave` hides the Save button, while omitting `onPolymerBuild` leaves Build live and molviewer
  downloads the `.mol2` itself, which is the right answer for a `+`-menu tab with no directory to
  write beside. Building is the one molviewer operation that deliberately does NOT change what is
  on screen (no action is dispatched, nothing is snapshotted, there is nothing to undo), so the
  monomer tab is untouched and the polymer becomes a NEW file plus a NEW tab.
  - **Naming is the host's job** and lives in `polymer-file.ts`:
    `<monomer-stem>_polymer_<e.monomers>.mol2`, later attempts suffixed `_2`, `_3`, … The stem
    comes from the tab's absolute `path`, NOT `e.sourceFileName` — same reasoning as `onSave`
    ignoring `e.fileName` — which also makes the event's `sourceFileName: null` case unreachable.
    `e.monomers` is the chain length in monomer units; `e.report` separately carries a physical
    length in Å.
  - **The collision check is the filesystem, never a listing.** `writePolymer` claims each
    candidate with `create-entry.ts` (`file_create_request` opens `wx`, create-exclusive) and
    advances on `exists`, capped at `MAX_POLYMER_NAME_ATTEMPTS`. This is why `createEntry` throws
    `CreateEntryError` carrying the raw server `code`: branching on rendered prose would break
    when the wording changes. Contrast `FileExplorer.uploadFiles`, which probes the cached listing
    and therefore has to fall back to a `window.confirm` overwrite prompt.
  - **Content goes through the binary upload stream, not `file_write_request`.** The latter caps
    at `MAX_INLINE_FILE_READ_BYTES` (5 MiB), reachable for a long chain of a large monomer; the
    upload (`useFileTransfer().upload`, which also invalidates the explorer listing) has no cap and
    opens the target `"w"`, filling the empty file the claim just created. A failed upload rolls
    the claim back via `delete-entry.ts` — best-effort, so a failing delete never masks the upload
    error the user actually needs.
  - **The new tab joins THIS viewer's pane**, resolved via `useLayoutStore.paneOfTab(workspaceCwd,
tabId)` — hence `MoleculeViewer`'s `workspaceCwd`/`tabId` props, both threaded from
    `MoleculeViewerPanel`'s `tab`. Without it a build started in a background pane would fling its
    result into the focused one. A null pane needs no special case: `openMoleculeTab` treats an
    unknown pane id as "not supplied".
  - `e.report.clashes > 0` surfaces a `warning`-variant `StatusBadge` (the variant added to
    `ui/status-badge.ts` for this, mapping to the existing `statusWarning` theme token). Rigid
    placement is never minimised, so overlapping atoms are a real result — reported after the
    write, not instead of it.
- **Live file watching (`use-file-watch`/`use-explorer-watch`/`use-file-live-refresh`).** All three
  subscribe to the daemon's `file_watch_subscribe`/`_unsubscribe` + `file_changed` push family
  (`packages/server/AGENTS.md` § File watching). `watchFile` (the framework-free core behind
  `useFileWatch`) ref-counts subscriptions per `(client, path)` in a module-level `WeakMap`
  registry (mirrors `file-transfer-instance.ts`'s shared-instance convention): a file tab and a
  diff tab open on the same path share ONE daemon watch and one `onSessionMessage` handler,
  instead of the second `file_watch_unsubscribe` killing it for both — the daemon's
  `SessionSubscriptions.add` disposes any existing entry for the same resolved-path key. It also
  remembers the RESOLVED path echoed back by `file_watch_subscribe_response.path` (the daemon
  expands a leading `~` server-side before pushing `file_changed`) and matches a push against
  either spelling. `useFileWatch(path)` (used by `MoleculeViewer` above, and by
  `useFileLiveRefresh` below) returns `{ changedAt: number | null }`, bumped on each matching
  push. `useExplorerWatch(expanded: Set<string>)` backs the live file tree: it diffs the
  `expanded` directory set across renders (subscribes newly-expanded paths, unsubscribes
  collapsed ones, never tears down and re-subscribes the whole set on an unchanged `Set`
  identity) through one shared `onSessionMessage` handler for the hook's whole lifetime, and
  invalidates exactly the changed directory's `rpcKeys.explorer(path)` query — never the whole
  `["explorer"]` family. A `too_many_watches` reply (the server's 128-per-session cap) is a soft
  failure: logs once via `console.warn`, leaves that directory (or, for `watchFile`, that path)
  unwatched, and falls back to the pre-existing `invalidateAfterToolCompletion` 500 ms post-tool
  debounce (`files-changed.ts`). `useFileLiveRefresh(path, cwd, viewerKind)` (`FilePanel.tsx`,
  sprint-044) is the third consumer: it watches a `kind:"file"`/`kind:"diff"` tab's own file —
  resolving a diff tab's git-relative `path` against its workspace `cwd` via the pure
  `resolveWorkspacePath` helper (`lib/paths.ts` — lifted out of this hook, task-002 sprint-045,
  now shared with `timeline/image-src.ts`'s `classifyImageSrc`) — gated on the registry-derived
  `LIVE_REFRESH_KINDS` set (`viewer-registry.ts`, sprint-063 — see AGENTS.md § Invariants "Adding
  a file viewer"; currently `text`/`markdown`/`image`/`html`; `video` is excluded because a
  refetch would restart playback from zero,
  `binary` fetches nothing eagerly so there is nothing to refresh), and unconditionally
  invalidates that path's `fileRead`/`fileDownload`/`fileDiffByPath` queries on each push — a
  watched tab's File/Diff toggle can show any of them, and invalidating a key with no live query
  is a no-op. Molecule tabs are NOT covered by this hook — `MoleculeViewer`'s own
  `shouldApplyRefresh` unsaved-edits gate stays the only reload path for molecule tabs. All three
  hooks' subscribe/diff/route/dispose core is framework-free (`watchFile`, `createExplorerWatcher`,
  `resolveWorkspacePath`) for the same jsdom-less reason below.
- **Shared file-source size ladder (`use-file-source`) + streaming fallback.** Every text-shaped
  viewer (`TextViewer`, `MarkdownFileViewer`, `HtmlViewer` — sprint-063 task-002) reads its content
  through one hook instead of each re-implementing tier 1 alone. Files are categorized by size:
  (1) `size ≤ MAX_INLINE_FILE_READ_BYTES` (5 MiB server-side, `packages/server/src/files/
limits.ts`) — the plain `useFileRead` path, unchanged; (2)
  `5 MiB < size ≤ MAX_DISPLAY_BYTES` (30 MiB, exported from `use-file-source.ts` — not a
  per-component local constant) — transparently refetch via the uncapped chunked binary
  `useFileText` (wraps `useFileDownload` + decodes blob to text; the decode query is keyed on
  `(path, objectUrl)` so a `fileDownload` invalidation's new object URL is picked up
  automatically) and render with a muted **"N.N MB file streamed"** note; (3)
  `size > MAX_DISPLAY_BYTES` — terminal state: no render attempt, just size/why/download action
  (reusing `BinaryFallbackViewer`'s pattern). The pure state-selection logic `selectTextViewerState`
  still lives in `text-viewer-state.ts` (framework-free, unit-tested directly, unmoved) — the hook
  is a thin composition of `useFileRead`/`useFileText`/`useFileDownload` around it, plus a bound
  `requestDownload()` on the terminal tier. When `useFileRead`
  throws `FileTooLargeError` (thrown by `parseFileReadResponse` when the server returns
  `error: "file_too_large"`), it carries `size` and optional `maxBytes` (additive RPC field),
  replacing string-code matching for a caller to decide whether to stream or show the terminal
  state.
- **Adding a file viewer.** `viewer-registry.ts`'s `VIEWER_REGISTRY: readonly ViewerDescriptor[]`
  (sprint-063) is the single registration point — `{ kind, component (lazy), extensions,
mimePrefixes?, liveRefresh }`. `liveRefresh` is a **required** field: a new `ViewerKind` cannot
  compile without an explicit choice, closing the gap where the pre-sprint-063 registry silently
  defaulted a forgotten kind to no live refresh. `VIEWER_BY_KIND`, the extension/MIME lookup
  tables, and `LIVE_REFRESH_KINDS` are all DERIVED from this one table at module load — never
  maintain a second list anywhere else. A file type that needs its own **tab kind** (not just a
  viewer inside the existing `file` tab kind) — the shape `MoleculeViewer` uses, with its own
  `tabIds.molecule`/`mol-<path>` identity and dispatch through `isMoleculeFile` at open-time,
  bypassing `detectViewerKind`/`VIEWER_BY_KIND` entirely — needs an explicit justification: it is
  a second dispatch path with real cost (persisted-tab-identity surface, a second place drag/drop
  and context menus must know about) and the registry is the default, cheaper path for anything
  that can render inside an ordinary `file` tab.
- **HTML preview sandbox (sprint-063/064).** `.html`/`.htm`/`.xhtml` files render through
  `HtmlViewer` inside a sandboxed `<iframe sandbox="allow-scripts" srcDoc={…}
referrerPolicy="no-referrer" allow="">` — never `src`, never a `blob:`/object URL as the document
  (measured, headless Chromium 2026-08-19: a sandboxed opaque-origin document cannot `fetch()` a
  parent-created `blob:` URL — `data:` is the only inlining vehicle, which is why sprint-064
  inlines local assets as `data:` URIs rather than rewriting them to blobs). Four invariants a
  future change must not quietly break:
  1. **Never `allow-same-origin`.** Paired with `allow-scripts` it re-grants the previewed document
     the app's own origin — its DOM, its `localStorage` (which holds the daemon password and
     connection state, `providers/kv-store.ts`), and its live authenticated WebSocket. Measured:
     with `allow-scripts` alone, the child's `location.origin` is `"null"` and both
     `parent.document` and `localStorage` throw `SecurityError`. `HTML_SANDBOX_TOKENS`
     (`html-sandbox.ts`) is a single frozen constant with a guard test
     (`html-sandbox.test.ts`) asserting `allow-same-origin`, every `allow-top-navigation*` form,
     and `allow-popups` never appear in it.
  2. **The injected CSP is a network policy, never the isolation boundary.** The `sandbox`
     attribute alone is what keeps the previewed document out of the app (invariant 1). The
     optional `<meta http-equiv="Content-Security-Policy">` `assembleHtmlPreview` injects when the
     per-tab "Block remote resources" toggle is on only decides whether the document may reach the
     _network_ — remote loading is **allowed by default** (a recorded product decision: the common
     case is an agent-produced report pulling a charting library from a CDN, and the residual risk
     the sandbox already bounds to "the document can talk to the network", never to app state).
     `HTML_PREVIEW_BLOCKING_CSP` carries `data:` in every directive an inlined asset can hit
     (`img-src`/`style-src`/`script-src`/`font-src`/`media-src`) — measured: `'unsafe-inline'`
     alone does **not** cover a `data:`-sourced element (a `<link href="data:text/css,…">`
     stylesheet needs `style-src`'s explicit `data:` token; a `data:`-sourced `<script src>` needs
     `script-src`'s), only a literal inline body.
  3. **`srcdoc`'s base URL is the app's own URL, not `about:srcdoc`** (measured) — so an
     un-rewritten relative ref would otherwise resolve against the app origin, where the SPA's
     history-fallback routing answers with `index.html` (a silently wrong 200, not a clean
     failure). `assembleHtmlPreview` injects `<base href="https://pi-studio-preview.invalid/">`
     whenever the source declares none of its own — paired with a small inline click-interceptor
     script (`FRAGMENT_ANCHOR_SCRIPT`) that keeps in-page `<a href="#…">` links scrolling instead
     of attempting a frame navigation to that `.invalid` host, which is what the injected base
     alone measurably caused (a `chrome-error://` page replacing the whole preview) before the
     interceptor was added.
  4. **Local-asset confinement is a hard security gate, not a convenience filter (sprint-064).**
     With remote loading on by default, a document naming `../../../.ssh/id_rsa` and fetched on
     its behalf could read the bytes back out of its own inlined `data:` URI and post them
     anywhere — `data:` is used for _every_ asset kind (images, stylesheets, scripts, fonts,
     media), never an object URL, for the same fetch-a-`blob:`-from-a-sandbox reason as the
     document itself. `confineAssetRef` (`html-assets.ts`) percent-decodes a candidate **exactly
     once, non-throwing** — _before_ any resolution or normalization — then resolves it, lexically
     collapses `.`/`..` segments (`lib/paths.ts`'s `collapseDotSegments`), and requires the result
     sit under the confinement root via a segment-aware check (`path === root ||
path.startsWith(root + "/")`, never a bare string prefix, which would wrongly accept a
     `/ws-evil` sibling of `/ws`). The decode-before-normalize order is load-bearing: the reverse
     order lets `foo%2F..%2F..%2F..%2Fetc%2Fpasswd` pass the root check as one opaque segment (no
     literal `/` yet) and only decode back into a real traversal afterward. The confinement root
     is the tab's workspace root — narrowed to the document's own directory
     (`confinementRoot`) when that root **is** the home directory itself (a workspace-less tab
     falls back to `cwd = "~"`, `FilePanel.tsx`; with all of `$HOME` as the root, `~/.ssh/id_rsa`
     would sit _inside_ it and the gate would be vacuous exactly where it matters most). Caps
     (`ASSET_LIMITS`: 64 assets, 2 MiB per asset, 16 MiB inlined total — `withinAssetCaps` is the
     one pure predicate that enforces them, driven by `html-asset-loader.ts` as bytes arrive) keep
     a skip visible rather than a silent multi-hundred-MB `srcDoc` allocation. Known limitations,
     recorded rather than papered over: only the top-level `<link rel=stylesheet>`/`<script src>`/
     `<img>`/`<source>`/`<video>`/`<audio>` attribute contexts and one nested level into an inlined
     stylesheet's own `url(...)` are resolved — `@import` chains beyond that one level, refs inside
     the document's own inline `<style>` blocks, and `<iframe src>` are never rewritten; only the
     document itself is watched for live refresh, so an edited _asset_ (not the document) updates
     on the toolbar's Reload, not automatically (`htmlAssetBundleByPath` invalidation, distinct
     from the document's own content-hash-keyed refetch); an HTML-entity-bearing ref
     (`a&amp;b.png`) is matched **as authored** — no entity decoding happens anywhere in the
     confinement path — so it simply fails to inline rather than resolving to the real file.

  The assembled `srcDoc` is memoized on exactly its real inputs (source content, the resolved
  local-asset map, `blockRemote`) and
  the `<iframe>` stays permanently mounted once content is available — the Preview/Source toggle
  hides it via `display: none` rather than unmounting it. Both matter for the same reason: React
  re-setting `srcDoc`, or React unmounting/remounting the iframe element, reloads the document and
  re-runs its scripts — real double side effects (a duplicate analytics beacon, a chart re-init) on
  every unrelated re-render or Preview↔Source round trip otherwise.

  Because it is a real cross-document child, the preview iframe also swallows the pointer and native
  drag events the pane machinery above it depends on — see § Invariants "An iframe must never
  hit-test during a drag" and "A pointer-driven resize drag must capture its pointer" for the two
  mechanisms that fix that. Neither belongs in `HtmlViewer` itself: both are viewer-agnostic.

- **Framework-free testing convention: no jsdom.** This package has no jsdom/React-Testing-Library
  DOM render tests despite `@testing-library/react` being a devDependency (the root Vitest config
  only discovers `.test.ts`, not `.test.tsx`, under a node environment). Hooks and components with
  real branching logic extract their logic into plain functions/factories (`watchFile`,
  `resolveWorkspacePath`, `createExplorerWatcher`, `loadInlineImage`,
  `mergeFileTextState`, `shouldApplyRefresh`, `moleculeSource`, `selectTextViewerState`,
  `assembleHtmlPreview`, `extractLocalAssetRefs`/`confineAssetRef`/`confinementRoot`/
  `rewriteHtmlAssetRefs`/`extractCssUrlRefs`/`rewriteCssUrls` (`html-assets.ts`), and
  `loadHtmlAssetBundle` (`html-asset-loader.ts`, driven with an injected fake `fetchBytes` —
  bounded-parallelism assertions use `Promise.withResolvers()` + deterministic microtask-tick
  draining rather than real timers)) that
  are unit-tested directly rather than via `renderHook` or mounting. This is now an established
  convention for this package (extended from `ModelMenu`'s own `sortCurrentFirst` pattern —
  existing precedent since sprint-043).
- **Inline image rendering (sprint-045, tasks 1-6 — fully wired).**
  `timeline/image-src.ts`'s `classifyImageSrc(src, base, homeDir)` is the pure gate for a markdown
  `![alt](src)`: `http:`/`https:`/`data:`/`blob:` → `remote`; any other `scheme:` (incl. `file:`)
  → `unresolvable`; `/…` → `local` as-is; `~`/`~/…` → expanded via `normalizeCwd` (unresolvable if
  `homeDir` unknown); `./…`/`../…`/bare relative → joined via `lib/paths.ts`'s
  `resolveWorkspacePath` against `base` (unresolvable with no base); final gate —
  `detectViewerKind(candidate) !== "image"` → unresolvable (so `.pdf`/`.txt` etc. never trigger a
  download; `.webp`/`.svg` both admit per `viewer-registry.ts`'s `VIEWER_REGISTRY` descriptor
  table (`EXT_TO_VIEWER` is a derived, module-internal lookup — not itself exported).
  `lib/inline-image-cache.ts` + `hooks/use-inline-image.ts`'s `useInlineImage`/`loadInlineImage`
  fetch over the same `transferFor(daemon).download(path)` primitive `use-file-download.ts` uses,
  but with a DIFFERENT retention policy: a module-scoped, ref-counted, ~32-entry LRU cache that
  revokes an object URL only on eviction or `clearInlineImageCache()` (wired into
  `connection-store.ts#disconnect()`) — never on row unmount, since the chat timeline virtualizes
  rows and `use-file-download.ts`'s revoke-on-unmount policy would re-download on every scroll
  past. **Deliberately not TanStack Query**, despite this package using it everywhere else for
  server data (`lib/connection/query-client.ts`): Query's retention model is "cache while
  observed, garbage-collect on `gcTime` after the last observer unmounts" — it has no notion of
  "keep this alive because a _different_, currently-unmounted row still refers to it," which is
  exactly the virtualization case above. Query also has no eviction hook to revoke an object URL
  at the moment an entry actually leaves cache; without that, unmounting the last observer would
  either revoke too early (URL dies while a sibling row still needs it) or never (`gcTime:
Infinity`, permanent leak). Do not migrate this cache onto Query — re-implementing ref-counted,
  LRU-bounded, revoke-on-evict retention on top of Query's own cache is strictly more code than
  the ~130-line hand-rolled module it would replace, for a policy Query cannot express natively.
  **Render layer (task-004):** `timeline/InlineImage.tsx` is `markdown.tsx`'s `img` node
  override, threaded an `assetBase: string | null` prop from `Markdown` → `AssistantRow` →
  `Timeline`'s `renderRow` (computed once per render as `normalizeCwd(session.cwd, homeDir)`) —
  the ONLY row kind that gets one; `ReasoningRow`/`MarkdownFileViewer`'s `<Markdown>` calls omit
  it, so every relative image path there classifies `unresolvable` and is never fetched. The
  actual remote/loading/ready/error render decision is extracted into a pure
  `timeline/inline-image-view.ts#selectInlineImageView` (this package's no-jsdom convention below)
  rather than tested by rendering `InlineImage.tsx` itself. A `ready` image is a click-to-open AND
  drag-to-split source: click dispatches through the shared `openFileTab` primitive (converged onto
  it in sprint-051, replacing an earlier hand-rolled `useTabStore.getState().open(...)` call), and
  drag writes the `EXTERNAL_DRAG_MIME.path` payload via `pathDragStartHandler` — both via the
  `timeline/file-open-target.ts#resolveFileOpenTarget`/`workspace/external-drag.ts` helpers § File
  link rendering below documents in full (this section's own render/click/drag mechanics are that
  section's, applied to images instead of links). **Capability gate:** `connection-store.ts`
  advertises `CLIENT_CAPS.inline_image_markdown` in every `hello` frame unconditionally (not
  feature-detected) — the daemon composes an image-rendering instruction into a NEW agent's system
  prompt only when it sees this flag on the creating connection, alongside the file-link
  instruction when `file_link_markdown` is also advertised (`packages/server/AGENTS.md` § Agent
  subsystem); the web-client side of this feature is just "always tell the daemon we can render
  `![](path)`," nothing here reads the flag back.
- **File link rendering (sprint-051, tasks 1-6 — fully wired).** Sibling to inline image rendering:
  `[label](path)` in a finalized assistant markdown block becomes an actionable open-file element
  instead of a plain navigating anchor. `timeline/href-resolution.ts#resolveHrefCandidate` is the
  step both this feature's `timeline/file-link-src.ts#classifyFileLinkSrc` and
  `timeline/image-src.ts#classifyImageSrc` now share for scheme detection, `~`/relative resolution
  (via `normalizeCwd`/`lib/paths.ts#resolveWorkspacePath` — never reimplemented), normalization
  (`lib/paths.ts#collapseDotSegments`, a lexical `.`/`..` collapser with no filesystem access), and
  percent-decoding (`decodeURIComponent`, malformed sequences kept raw rather than throwing).
  `classifyFileLinkSrc(href, base, homeDir)` is a two-way split — simpler than the image
  classifier's three-way one: no extension gate (a directory-shaped path still classifies `local`),
  and anything that isn't a resolved local candidate is `external` outright (never a degraded
  fallback, since a non-file `href` may be a genuinely working link) — a fragment-only href
  (`#section`) is `external` too, so in-page anchors are never intercepted.
  **Render layer:** `timeline/FileLink.tsx` is `markdown.tsx`'s `a` node override, threaded the
  same `assetBase`/`owningPaneId`/`workspaceCwd` props as the `img` override. `external` renders a
  plain, unmodified `<a>`; `local(path)` renders an actionable, draggable one.
  **Converged click-to-open + pane targeting:** both `FileLink` and `InlineImage` dispatch through
  `openFileTab` (`features/files/open-file-tab.ts`, the same primitive the Files tree and its
  context menu use) with arguments from one shared pure function,
  `timeline/file-open-target.ts#resolveFileOpenTarget(assetBase, owningPaneId, workspaceCwd)` —
  `workspaceCwd` prefers the owning chat tab's real cwd over the `assetBase || "~"` approximation
  (which now only applies on markdown surfaces rendered outside any tab), and a `null` owningPaneId
  becomes `undefined`, matching `openFileTab`'s `targetPaneId` contract and falling back to
  whichever pane is globally focused. **Pane-owner propagation:** `owningPaneId`/`workspaceCwd` are
  threaded top-down as plain props — `TabPanelHost` resolves a tab's pane id via
  `features/workspace/pane-layout-view.ts#resolveOwningPaneId(tabId, layout)` (this file's home for
  `TabPanelHost`'s testable render decisions) and passes it into `PanelProps`; `ChatPanel` forwards
  it plus `tab.workspaceCwd` into `Timeline`; `Timeline#renderRow` forwards both into
  `AssistantRow`/`ReasoningRow`, which forward them into `Markdown`, which passes them to both the
  `img` and `a` overrides. Every layer from `TabPanelHost` through `Timeline` requires a real,
  non-optional value (the panel host always has one to give); `AssistantRow`/`ReasoningRow`/
  `MarkdownProps`/`InlineImageProps` stay optional, `null`-defaulted, since `react-markdown` may
  omit props at that boundary. **Drag-to-split:** a `local` `FileLink` and a `ready` `InlineImage`
  are both native-HTML5 drag sources via `features/workspace/external-drag.ts#pathDragStartHandler`
  — one shared closure writing the identical `EXTERNAL_DRAG_MIME.path` payload a Files-tree row
  drag writes (`FileExplorer.tsx#handleDragStartRow`), so `use-external-pane-drop.ts`'s existing
  generic `path`-kind drop handling needs no changes. An `external` link or a remote image is never
  a drag source for this payload — the browser's own default drag behavior applies unmodified.
  **Capability gate:** `connection-store.ts` advertises `CLIENT_CAPS.file_link_markdown`
  unconditionally, alongside `inline_image_markdown`, same pattern — see
  `packages/server/AGENTS.md` § Agent subsystem for the daemon-side `composeSystemPrompt`
  composition both flags now share.

- **Mermaid diagram rendering.** Sibling to inline image/file-link rendering, much simpler:
  `timeline/markdown.tsx`'s `code` node-override (`CodeRenderer`) branches on the fenced block's
  `language-xxx` tag — a `language-mermaid` block dispatches to `MermaidBlock` instead of the
  existing Shiki `CodeBlock` path. `MermaidBlock` dynamically imports `mermaid` (same lazy-chunk
  rationale as `@molviewer/core`'s vendor chunk — its parser/renderer is a few hundred KB nobody
  should pay for until a message actually contains a diagram) and renders via
  `mermaid.render(id, code)` into `dangerouslySetInnerHTML` — mermaid's own sanitized SVG output
  (`securityLevel: "strict"`), not raw user HTML; invalid diagram syntax falls back to the raw
  fenced code plus mermaid's own error message rather than losing the rest of the message.
  **Theming is NOT a `var()` passthrough** like `<MolViewer>`'s (`molecule-theme.ts`) — mermaid's
  `khroma` color engine computes derived shades in JS before any CSS reaches the DOM, so it cannot
  resolve a `var(--pi-color-*)` reference. `timeline/mermaid-theme.ts#readMermaidThemeVariables`
  reads pi-studio's live theme off `document.documentElement`'s COMPUTED custom properties instead,
  handing mermaid concrete hex strings. Read once per diagram mount — a diagram already on screen
  does not retheme without remounting if the user switches theme mid-session; accepted, not fixed.
  **Capability gate:** `connection-store.ts` advertises `CLIENT_CAPS.mermaid_diagram_markdown`
  unconditionally, alongside `inline_image_markdown`/`file_link_markdown` — see
  `packages/server/AGENTS.md` § Agent subsystem for the daemon-side `composeSystemPrompt`
  composition all three flags now share. Unlike the sibling features, client-side render dispatch
  is unconditional on this flag — a `language-mermaid` block always renders as a diagram
  regardless of what any connection advertised; the flag only gates the agent instruction.

- **Model selector (sprint-043; lives in the composer's bottom toolbar) + eager draft
  materialization.**
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
  ProviderRegistry). `ModelMenu` itself owns no trigger element: it takes a
  `renderTrigger(currentModel)` prop and wraps whatever the caller renders in
  `DropdownMenu.Trigger asChild` — today `Composer.tsx`'s toolbar button (`styles.modelBtn`:
  model name + chevron), showing `session.model` or a `"Model"` placeholder. It also passes
  `align="end"`, overriding `MenuContent`'s `align="start"` default, because that trigger sits at
  the right edge of the composer; a start-aligned popup would hang off the panel. The status bar
  no longer renders `ModelMenu` or holds any model-picking code.

  **A brand-new "New chat" tab materializes the instant its tab is created, not on first
  keystroke/pick/send.** `tab-store.ts`'s `openNewChat` fires `stores/materialize.ts`'s
  `ensureMaterialized(client, id)` right after `createSession`+`open` — the tab/sidebar row
  appear synchronously, and the real, persisted `AgentRecord` (see below) is created in the
  background, best-effort (a failure or an offline open is retried by `Composer.tsx`'s `submit()`,
  which still calls `ensureMaterialized` unconditionally before every send — the one remaining
  place other than `openNewChat` and `Composer.tsx`'s `handleSelectModel` that calls it).
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

  **Once the session has a bound `agentId`,** `Composer.tsx`'s `handleSelectModel` still awaits
  `ensureMaterialized` unconditionally (a no-op once bound, the common case now) before firing
  `client.agent(agentId).setModel(modelProvider, modelId)` (`agent_set_model_request`) — one path
  regardless of materialization state, unlike the old branch that returned early (silently
  dropping the pick) whenever a materialize was already in flight, which eager materialization
  made the COMMON case rather than a rare race. Rejections are swallowed with no dedicated UI
  surface (same swallow-and-let-the-broadcast-be-authoritative convention as its own
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

- **Turn progress bar (sprint-060).** `TurnProgressBar.tsx` (`features/chat/`) is the running
  affordance — one indeterminate bar per pane, mounted absolutely at the top of `ChatPanel`
  (`position: absolute`; `ChatPanel` gives it a `position: relative` host) so its mount/unmount
  never reflows the virtualized `Timeline` beneath it or disturbs the bottom anchor (see
  "Timeline bottom anchor" below).
  Trigger is `session.status === "running"`, read straight off the store — not a local
  `turn_started` listener — which is what makes a mid-turn page reload show it immediately (the
  hydrated daemon status `use-session-restore.ts` sets, before any stream event arrives) instead of
  waiting for the next event. It replaced the prior "Agent is working…" bouncing-dots indicator
  (`Timeline.tsx`), retired in the same sprint. Every new CSS animation in this codebase MUST carry
  its own `@media (prefers-reduced-motion: reduce)` override, local to that module — there is no
  shared motion utility and none should be added for a single override.

- **Workspace tab strip (sprint-061).** `TabStrip.tsx`/`.module.css` (`features/workspace/`), the
  0.1.0 UI redesign's § 07. Six traps worth knowing before touching this file:
  - The strip band's height is declared **once**, as `--pane-strip-height` on
    `TabPanelHost.module.css`'s `.area`. `pane-layout-view.ts`'s `calc()`s, the strip's own
    `min-height`, and `TabPanelHost.module.css`'s empty-state offsets all read that one variable —
    `pane-layout-view.test.ts` asserts the `calc()` strings symbolically, so changing the number
    means editing one CSS declaration, never those tests. It is a `--pane-*` name on purpose:
    `--pi-*` is theme-emitted and `theme/token-integrity.test.ts` fails any `var(--pi-…)` the theme
    does not define. It matches `platform/breakpoints.ts`'s `WORKSPACE_SECONDARY_HEADER_HEIGHT`.
  - **Tabs shrink, trailing chrome does not.** `.tab` is `flex: 0 1 auto; min-width:
var(--pi-spacing-128); max-width: 200px`, and only `.tabLabel` ellipsises. `.tabs` is
    `flex: 0 1 auto` — never `1 1`, which would eat the free space and shove "+" against the split
    buttons — and scrolls only once pills hit their floor; "+" and `.stripActions` stay `flex: none`
    outside that scroll container so they stay reachable in a narrow pane (sprint-049's fix,
    preserved).
  - The close (×) box is reserved and toggled with `opacity`, never `display`/`visibility`, so
    hovering an inactive tab never re-truncates its label. Visible on the active tab, on
    hover/keyboard-focus of an inactive one, and unconditionally under `@media (max-width: 575px),
(hover: none)` — the CSS mirror of `components/primitives/helpers.ts`'s `hoverVisible`, because
    nothing in this package feeds a live pane width into that JS helper.
  - "+" stays a sibling of `SortableContext`, never wrapped into it or into `.stripActions` (GitHub
    issue #8: a sortable "+" poisons `closestCenter` collision detection).
  - Every glyph in this file routes through the `Icon` primitive at a token size
    (`icon-size-xs`/`sm`) — never a raw lucide element with a literal `size={n}`.
  - A tab's attention `StatusDot` is a projection of its session's status via
    `tab-attention.ts` (running/error only), never new per-tab state — there is no unread/dirty flag
    on `Tab`, and the pane's active chat tab deliberately shows no dot because `TurnProgressBar`
    already states that case under the strip.

- **Slash-command picker (`/` in the composer, web-client slash commands).** Discovers Pi's
  `agent_list_commands_request` (`packages/server/AGENTS.md` § "Command discovery") through
  `use-agent-commands.ts`, cached IDENTICALLY to `use-provider-models.ts` — same `useQuery` shape,
  no `staleTime`/`gcTime`/`retry` override, keyed by `["agents","commands",sessionId]` (session id,
  not agent id, so a draft that materializes mid-open doesn't orphan its cache entry). This is
  deliberate, not an oversight: reopening the menu (including the auto-open on every `/` keystroke)
  renders the cached rows immediately with no spinner while a background refetch keeps the list
  current, exactly like the model picker.
  - **`CommandMenu.tsx` reuses `ModelMenu.module.css`'s chrome, not `ModelMenu.tsx`'s code.**
    `ModelMenu` owns its `open`/`query` state privately and renders its own search `<input>`;
    neither fits a menu whose open state and filter query are driven entirely by the composer's
    textarea. `CommandMenu` takes `open`/`onOpenChange`/`options`/`highlightedIndex` as props and
    renders rows as `<div role="option">`, not `DropdownMenu.Item` — `Item` brings Radix roving
    focus/typeahead, which would fight the textarea for keyboard focus.
  - **Both `onOpenAutoFocus` AND `onCloseAutoFocus` on `DropdownMenu.Content` must be prevented.**
    Preventing only the open side (so typing `/` doesn't yank focus into the menu) is not enough:
    Radix's default is to return focus to the trigger element whenever `open` flips to `false`,
    which fires AFTER `applySelectedCommand`'s own `el.focus()` on the textarea and silently undoes
    it — a real, live-caught bug (every close, not just Escape, routes through this: apply,
    Escape, and click-away all flip `open` to `false` the same way). The `/` trigger button must
    never end up focused after any close.
  - **`Composer.tsx`'s `submit()` must close the menu itself**, not just `applyCommand`'s
    trailing-space path (`shouldOpenMenu(" …")` → false). A bare Enter or a Send/Steer button click
    can fire while the menu is still open over a draft with zero filter matches (`filtered.length
=== 0`, so `handleKeyDown`'s accept branch never ran) — without an explicit `setMenuOpen(false)`
    in `submit()`, sending clears the draft to `""` but leaves the menu open, which then renders
    the full unfiltered list (empty `text` → `parseSlashToken` → `null` → unfiltered `options`)
    right after the send. Another real, live-caught bug.
  - **The highlight is `applyCommand`'s contract, not decoration.** `knownCommandSpan(text, names)`
    (`slash-commands.ts`) only marks the leading token when it exactly, case-sensitively matches a
    name from the same `get_commands` payload — the identical test Pi's own `agent-session.js`
    applies before executing a command — so a highlighted token is a live "Pi will recognize this"
    guarantee, not styling. Rendered via a transparent-text mirror `<div>` behind the `<textarea>`
    (`.highlightLayer`/`.commandMark` in `Composer.module.css`), NOT a rich editor — swapping the
    textarea for CodeMirror/contenteditable would rewrite paste, attachment, and autosize behavior
    the composer already handles.
  - **The mark's chip padding comes from `box-shadow` spread, never `padding`/`margin` on the
    horizontal axis.** `.highlightLayer` is a transparent-text mirror that must stay
    pixel-identical to the real `<textarea>` underneath it, character for character — any
    horizontal padding on `.commandMark` would add real width to that inline span, shifting every
    character after it in the mirror layer out of alignment with the real text. `box-shadow`
    paints outside the layout box entirely, so a zero-blur, positive-spread shadow extends the
    same wash color a few px past the glyphs without changing the box's width at all — real chip
    breathing room, zero risk to the alignment invariant.
  - **Mouse hover and keyboard selection are two independent, differently-styled states, not one
    shared `highlightedIndex`.** Native CSS `:hover` (`.commandItem:hover` in
    `ModelMenu.module.css`) drives mouse feedback — the browser's own hit-testing, always
    accurate, never missing a fast pointer move. `.commandItem.itemActive` (accent-tinted fill +
    left bar, overriding the shared `.item.itemActive` rule's plain surface-color fill, which was
    too close in luminance to `.commandContent`'s own background to read as "selected") is driven
    only by `highlightedIndex`, which only `ArrowUp`/`ArrowDown` ever write — mouse hover no
    longer syncs into it via `onMouseEnter`. An earlier version routed hover through that same
    state so both states could share one look; that added a React render round-trip to something
    the browser already tracks for free, and could miss fast pointer movement (the old highlight
    staying stuck on a row the mouse had already left). Because the two states now render
    differently, they can safely coexist when arrow-key nav scrolls the list under a mouse
    pointer that never moved: the stale hover on whatever's now underneath reads as a subtle,
    clearly-secondary cue next to the real accent-marked selection, never a confusing duplicate.
  - **`onOpenAutoFocus` on `DropdownMenu.Content` is real but not in Radix's public prop type.**
    `MenuContentImpl` (`@radix-ui/react-menu`) destructures and forwards it at runtime, but the
    public `DropdownMenuContentProps` type deliberately omits it (`MenuContentImplPrivateProps`,
    internal-API-only) — passing it as a plain JSX attribute fails typecheck with "did you mean
    onCloseAutoFocus". `CommandMenu.tsx`'s `preventOpenAutoFocus` constant is typed separately and
    spread in (`{...preventOpenAutoFocus}`), which is honest about the gap without widening
    `DropdownMenu.Content`'s props as a whole. This was a real, unnoticed break because
    `packages/web-client` isn't in the root `tsconfig.json`'s project references — `npm run
typecheck` never covers it; only the full `npm run build` (which runs `vite build`'s own
    `tsc -b`) catches it.
  - **Extension-sourced commands are hidden, not disabled, while a turn is running**
    (`commandOptions(commands, { running })` in `slash-commands.ts`): Pi rejects extension commands
    on `steer`/`follow_up` (`_throwIfExtensionCommand`), the only send path while a turn is in
    flight, and that rejection is a silently-dropped `notify` response at the transport layer — so
    offering them here would fail invisibly. Prompt templates and skills are unaffected; they still
    expand into a normal turn either way.
  - **Live-verified against a real spawned `pi` process, not just the mock provider**: Pi only
    scans a project's `.pi/prompts/`/`.pi/extensions/` when the CWD is a trusted project (Pi's own
    `~/.pi/agent/trust.json`, `defaultProjectTrust`) — an untrusted directory silently returns zero
    project-scoped commands from `get_commands`, not an error. This is a Pi-side gate this feature
    does not (and should not) work around.
- **Status bar (sprint-042).** `StatusBar.tsx`, mounted once in `WorkspacePage` (always on
  screen, unlike any feature panel), renders five read-only segments for the **active session**
  in order: cwd, git branch (+ ahead/behind/dirty/conflict), context usage, token total, cost.
  Each renders only when its underlying value exists (`gitAvailable`, `session`, …), and the
  leading chevron is a plain `i > 0` check over the one `segments` array. **Nothing here is
  interactive.** The model picker sprint-043 put in this bar has moved to the composer's bottom
  toolbar (see "Model selector" above), which is why this file imports no `ModelMenu`,
  `useConnectionStore`, or `ensureMaterialized`. Reads
  `session-store`/`git-store`/`stats-store` (all reactive selectors); polls via
  `useSessionStats(activeSessionId)`. Two subtleties that matter if you touch this area:
  - **`StatusBar` is the SOLE owner of the checkout-status subscription** (`useCheckoutStatus`),
    keyed off `tab-store.activeWorkspaceCwd` — NOT `session.cwd` (a per-session field), and NOT a
    per-panel subscription. `ChangesPanel.tsx` used to own this subscription itself, opening it
    only while the Changes tab was visible; it is now a pure `git-store` reader, as is
    `FileExplorer.tsx` (whose row tinting/ghosting goes through `git-status-index.ts`). The daemon's
    `checkout_status_subscribe`/`_unsubscribe` handlers key on a flat, non-reference-counted
    `session:cwd` map (`packages/server/src/projects/git-checkout-rpc.ts`) — a SECOND independent
    subscriber to the same cwd is not additive, it's a race: whichever one unmounts first silently
    kills the live feed for the other too. Never add a second `useCheckoutStatus(cwd)` call
    anywhere in this app for the same cwd `StatusBar` is already watching — read `git-store`
    instead, which is what makes the Files tree's tinting free.
  - **The context/token/cost/model fields are pull-only** — no `AgentStreamEvent` kind carries
    them (see `agentStreamEventSchema` in `@av-pi-studio/protocol`). `use-session-stats.ts` polls
    `client.agent(id).sessionStats()` on mount/session-switch, on a ~12s interval, and immediately
    when the session's `status` transitions away from `"running"`. Its `applySessionStats` also
    writes a poll-returned `model` back into `session-store` (not just `stats-store`) — the
    composer's model button reads `SessionEntry.model`, so skipping this write-through leaves it
    showing the `"Model"` placeholder forever even though the poll succeeded (a real bug
    sprint-042's live smoke test caught before it shipped). This poll runs off `StatusBar`'s
    mount, so the model label depends on this bar being on screen even though the label isn't.
- **Timeline bottom anchor: only a gesture detaches, only proximity re-attaches.** Following the
  live agent output is split in two along the line of what an effect can actually do.
  - **Staying pinned while existing content grows is the virtualizer's job** — `Timeline.tsx`
    passes `anchorTo: "end"` (plus `scrollEndThreshold: AT_BOTTOM_THRESHOLD_PX`), which
    compensates every size change inside `resizeItem`, before paint. This covers the cases an
    effect structurally cannot: streamed text appended into the assistant row that already exists,
    a tool card's growing output tail, a late image/mermaid/highlight resolve, and an estimated
    row height being replaced by its real measured one. Do NOT reintroduce an app-level
    "scroll again after it grew" effect — it runs after the fact and always loses a frame.
  - **Deciding whether to follow at all is `timeline/bottom-anchor.ts`** (pure, unit-tested) driven
    by `features/chat/use-bottom-anchor.ts` (listeners + `ResizeObserver`). One boolean, two
    rules: a **user gesture** (`wheel`/`touchmove`/`pointerdown`/`keydown`, matched to the scroll
    it causes by a 500ms window) that lands further than `AT_BOTTOM_THRESHOLD_PX` from the bottom
    detaches; any scroll back within that distance re-attaches. A scroll no gesture produced must
    NEVER detach: the previous controller derived the flag from raw scroll position on every
    event, so a virtualizer correction, a StrictMode re-attach, or the `scrollTop` a
    `display:none` tab restores when it is shown again silently killed following for the rest of
    the turn, with no user input at all.
  - **A hidden tab can neither be measured nor scrolled.** Live-verified: under `display:none` the
    scroller reports `clientHeight`/`scrollHeight`/`scrollTop` as `0` and **ignores `scrollTop`
    writes**. So `isLaidOut()` gates every metric-derived decision, pinned state is simply held
    across the hidden period, and the anchor re-asserts the bottom on the `ResizeObserver`'s
    0→real-height transition. That observer — not a `visible` prop threaded through `PanelProps` —
    is deliberate: pane splits, divider drags, workspace switches, window resizes and the mobile
    keyboard all change the same box, and this keeps the fix local to the one scroller that cares.
  - **`estimateSize` is a real median (160px), not a placeholder minimum.** Every unmeasured row
    is estimated with it, so the further it sits from reality the further a restored
    conversation's first jump-to-bottom lands from the true bottom (measured rows in a live
    session ranged 51–571px; the old `48` under-estimated by ~3.4× and was the visible half of
    "resuming a conversation doesn't scroll all the way down").
  - **One scroller element for both the empty and populated states.** Rendering a different
    `div` per branch would detach/re-attach the virtualizer and its listeners on a chat's first
    message. `.root` exists because the jump-to-latest button cannot live inside the scroller (an
    absolutely-positioned child of a scroll container scrolls away with the content).
  - Consequence worth knowing: while pinned, expanding the **last** tool card scrolls to the end
    of its newly revealed body rather than its header — the anchor cannot distinguish growth the
    user clicked for from growth the agent streamed, and special-casing one of them is what made
    the previous design unmaintainable.
- **Sidebar row/dot presentation has one source (sprint-062).**
  `features/sessions/session-presentation.ts`'s `sidebarSessionView`/`workspaceAttentionDot` are
  the only place a `SessionEntry`/workspace becomes a sidebar row state, meta string, failure
  reason, or `StatusDot` input; `status-map.ts`'s `toDotStatus` remains the single
  protocol-status→dot-vocabulary translation point underneath it — neither `SessionItem.tsx` nor
  `WorkspaceGroupHeader.tsx` derives status independently.
- **No cwd, agent id, message count, timestamp, or cost in the sidebar meta line.** § 03's row
  redesign reduced the meta line to status only (plus a short failure reason for a failed turn);
  do not reintroduce any of those fields into `SessionItem`'s meta row.
- **The workspace band is `surface2`, edge-to-edge, with a top+bottom `border`, and its hover lift
  applies in both expanded and collapsed states.** `surfaceWorkspace` (the token the band used
  before sprint-062) has no remaining consumer in `SessionList.module.css` — it stays emitted in
  `ThemeColors` (part of the theme contract; `token-integrity.test.ts` only checks
  reference → emitted, never the reverse) but must not be reintroduced for the band.
- **Session-row selection is fill + inset ring + `accentForeground` + a left bar; activity is the
  `StatusDot` ring, never the fill.** A running-but-unselected row keeps the idle fill and shows
  only the ring — sprint-062 deliberately dropped § 03's mock's half-opacity activity bar so
  "selected" and "running" stay two independent, unambiguous signals.
- **`SessionItem`'s `StatusDot` renders in the meta row, immediately before the status text — not
  in the title row.** Stacking it against the title row's reserved `⋮` box left it floating with
  dead space before the row's true right edge once the label's `flex: 1 1 auto` pushed that
  cluster flush right; the title row is label + reserved `⋮` only. `.meta`/`.metaDot`/`.metaLabel`
  in `SessionList.module.css` lay the dot directly before `view.meta` and shrink it via the
  `--status-dot-size`/`--status-dot-border-width` custom properties `StatusDot.tsx`/
  `.module.css` read with their normal 8px/12px fallbacks — every other `StatusDot` call site
  (`TabStrip`'s tab dot, `WorkspaceGroupHeader`'s attention dot) is unaffected since it never sets
  those properties.
- **`needs input` is unsourced in this client and must not be faked.** The web client has no
  `agent.permission.*` plumbing and the stored `AgentStatus` enum
  (`initializing|idle|running|error|closed`) has no `waiting` member; do not invent a fifth
  sidebar row state or a permission-derived dot without first landing the underlying RPC/store
  support.
- **The sidebar's reserved-`⋮` pattern mirrors `TabStrip.module.css`'s `.tabClose`.** Both the
  workspace band's and the session row's `⋮` occupy a fixed box (`opacity`-toggled, never
  `display`-toggled) so hover/focus never shifts the label's truncation point, and both are
  unconditionally visible below the `575px` breakpoint or on a coarse pointer
  (`@media (max-width: 575px), (hover: none)`) — a new hover-reveal affordance in this file should
  follow the same box-reservation contract rather than inventing a new visibility rule.
- **Exactly one open-workspace affordance lives in the sidebar: the pinned footer row.**
  `SessionList.tsx`'s footer (`+ Add workspace`, outside the scrolling `.list` container) is the
  sidebar's sole `openCwdPicker()` entry point since sprint-062 removed the header's icon button;
  `TabPanelHost.tsx`'s "No workspace open" empty-state button is a separate surface (a different
  empty state, not the sidebar) and is unaffected by this rule.
- **The connection bar's state shape lives in `connection-presentation.ts`, not in the component.**
  `ConnectionBar.tsx` binds stores to DOM only; which of the five states is active, the pill text,
  whether the url/password fields render or freeze, and the primary action's label/variant/disabled
  flag all come from `connectionBarView()` (design spec § 08). `closing` is a real `ConnectionState`
  the spec doesn't draw — it renders as the connected shape with a disabled action rather than a
  sixth visual.
- **The bar's 26px control height and `2xs` action font are deliberate `Button` overrides.**
  `ui/button.ts` floors `xs` at 28px and inlines both `minHeight` and `fontSize`, so class rules
  cannot win; § 08's geometry is applied through `style` at the call site (`Button` spreads `style`
  last). Removing those overrides silently regrows the action out of alignment with the pill/fields.
- **A failed WebSocket never yields a reason, so the pill must not print the raw error.** A browser
  WS failure rejects with an `Event`, which `connection-store`'s `String(error)` fallback turns into
  `"[object Event]"`; `shortConnectionReason()` filters that (and any `[object …]`) to
  "connection failed", and the pill's `title` falls back to the same text instead of the internals.
- **Only the url/password fields may shrink in the bar.** Title, status pill, action and panel
  toggles are all `flex: none`; the fields carry `flex: 0 1 <basis>` plus a `min-width` floor, and
  the bar itself scrolls horizontally once that floor is hit — it never wraps to a second row.
  `input.field` uses element+class selectors so the bar's restyle of the `TextInput` primitive wins
  regardless of CSS-module bundle order.
- **Stacked dialogs: the lower one MUST suppress dismissal that belongs to the upper one
  (sprint-065).** Every `Dialog` portals its content to `body`, so two open dialogs are DOM
  siblings, not nested — a pointerdown inside the upper dialog is an _outside_ interaction on the
  lower one, and Radix dismisses it. Clicking the login dialog's Cancel therefore closed the
  Settings dialog with it. `Dialog` forwards `onInteractOutside`/`onEscapeKeyDown` to
  `Dialog.Content` for exactly this; `SettingsDialog` uses two rules, and both are needed:
  `preventDefault()` while a login is pending, **and** `preventDefault()` when the interaction's
  original target is no longer `isConnected`. The second rule is not belt-and-braces — Radix
  defers a non-mouse `pointerdown` to the following `click`, so by dispatch time the upper dialog's
  own handler has already closed it and cleared the pending state, making the first rule test
  false. Any future second-level dialog needs the same treatment.
- **`SettingsDialog` mounts on `settingsOpen`, not on the gear's own click handler
  (sprint-065/task-006).** `ConnectionBar` lazy-imports the settings chunk only once it has ever
  been opened, latched by a local `settingsEverOpened` boolean. That boolean is an `useEffect` on
  `ui-store`'s shared `settingsOpen` field, not a side effect of the gear button's `onClick` —
  `openSettings()` called from anywhere else (`Timeline`'s onboarding nudge is the first other
  caller) must also trigger the first-mount import and render the dialog `open`. A latch owned
  only by the click handler would leave the nudge's `openSettings()` silently no-op the first time
  a session never touches the gear.
- **Provider auth goes through SDK methods only, never `client.connection.request` directly, and
  no secret ever enters a store or `localStorage` (sprint-065, live-verified task-007).** Every
  `ModelProvidersPanel`/`LoginDialog` call goes through `listProviderAuth`/`loginProvider`/
  `logoutProvider` on the `PiStudioClient` facade (`packages/client/AGENTS.md`'s Provider auth
  section). A live sweep entering a real key through the browser confirmed: on a **direct**
  connection the typed value appears in exactly one outbound WS frame
  (`provider_auth_respond_request`, the wire's only legitimate carrier) and nowhere else; over the
  **relay** transport it appears in zero frames at all (E2EE-wrapped before it ever reaches the
  wire); in both cases `localStorage` and the DOM contain zero copies after submit, and the
  daemon's own debug-level logs never print it. `qrcode` (`QrCode.tsx`) is a `devDependencies`
  entry, not a runtime dependency — bundled only into the lazy `features/settings`/
  `features/provider-auth` chunk (`ConnectionBar.tsx`'s comment on why the settings import is
  deferred until the gear is first used).
- **A flow started in an effect must gate its terminal dispatch on a ref, never a closure flag
  (sprint-065).** `<StrictMode>` is on (`main.tsx`), so effects run mount → cleanup → remount on
  the same fiber. `LoginDialog` needs a `startedRef` so the phantom remount does not start a second
  login (`loginProvider()` throws when one is active), but that guard means the _only_ live flow is
  the one the phantom cleanup already tore down. Gating its `done` dispatch on a per-closure `live`
  flag silently swallowed the terminal event: prompts still rendered and answered, the credential
  reached `auth.json`, and the dialog sat on the last prompt forever. Use a `mountedRef` the
  remount restores instead. (Related dev-only trap: editing such a component mid-flow makes Fast
  Refresh re-run the effect, rejecting the prompt resolver while reducer state survives — hard-reload
  before verifying a flow.)
- **A prompt's own `signal` is the only notice that it was retired (sprint-065).** Pi races a
  `manual_code` prompt against its OAuth callback server, so the callback winning cancels the
  question while the flow carries on. The SDK consumes `prompt_cancelled` itself — it rejects its
  internal race and _discards_ the promise the view returned — so `onEvent` never sees it and the
  view has no other signal. `ProviderAuthPromptUi.signal` (added in `packages/client`) aborts for
  exactly that prompt; `LoginDialog` listens and drops the input, leaving the auth url, QR and
  status region up. Without it the paste field stayed on screen after the callback had already won.
- **Never gate a prompt's Submit on a non-empty input (sprint-065).** Blank is a meaningful answer:
  GitHub Copilot's OAuth flow opens with "GitHub Enterprise URL/domain (blank for github.com)", and
  disabling Submit on `length === 0` made that flow impossible to advance at all. The provider
  decides what it accepts — `pi-studio auth login` puts no non-empty validation on its own input
  either.
- **An answered prompt must be retired by the view, not the reducer (sprint-065).** `login-flow.ts`
  keeps `state.prompt` until the next prompt or `done` arrives, which is correct for a pure log of
  what the daemon said — but flows can sit in a progress step for seconds afterwards, leaving an
  already-answered question and an empty box next to the device code the user is reading.
  `LoginDialog` tracks `answeredPromptId` locally and renders only the prompt still awaiting an
  answer.
- **`lib/clipboard.ts`'s fallback must append its scratch textarea inside the active focus scope
  (sprint-065).** Every caller sits inside a Radix overlay, and those trap focus: appended to
  `document.body`, the trap synchronously pulls focus back out on `focus()`, collapsing the
  selection — and `execCommand("copy")` then returns **`true`** having copied nothing, so the caller
  reports success with an empty clipboard. It now hosts the textarea in the nearest
  `[role="dialog"]`/`[role="menu"]`, asserts the selection really covers the text before trusting
  the return value, and restores focus afterwards. This affected the pre-existing file-explorer
  "Copy Path" actions too, on any non-secure context (plain-http LAN) where the fallback is the
  only path.
