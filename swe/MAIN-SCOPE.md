use # Pi-Studio — Clean Room Technical Scope

> Clean-room specification. Describes behavior and contracts for independent reimplementation.
> No source code is reproduced from the original project. Public names (routes, env vars, message
> types, config keys, table/field names) are reproduced where they are part of the interface.

## 1. Purpose & Summary

Pi-Studio is a self-hosted, local-first system for running, monitoring, and controlling the **Pi**
AI coding agent from desktop, mobile, web, and the terminal. The development workflow it targets is **orchestration of
agents** rather than direct file editing: a user launches one or more agents inside project
workspaces, watches their output stream in real time, approves tool-call permissions, and ships
results — from any device.

The core is a **daemon** (a long-lived Node.js process) that runs on the user's machine, spawns and
supervises the Pi agent process (`pi --mode rpc`), and exposes a single WebSocket API. Multiple **clients** (an Expo mobile/web app, an Electron desktop wrapper, and a
Commander.js CLI) connect to the daemon — directly on localhost/LAN, remotely through an
end-to-end encrypted **relay**, or from Electron desktop through an **SSH gateway tunnel** to a
remote daemon's localhost listener. Code never leaves the user's machine; Pi-Studio manages no API keys and
adds no inference cost (bring-your-own-keys). It has no telemetry and no forced login.

Guiding principles: cross-device, self-hosted, privacy-first, open source (AGPL-3.0). The protocol
is append-only/backward-compatible; individual features may require a newer daemon and are gated by
capability flags.

## 2. Tech Stack & Runtime

| Concern             | Choice                                                            | Notes                                                         |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| Language(s)         | TypeScript (ESM)                                                  | Strict typing; Zod runtime validation at all boundaries       |
| Daemon runtime      | Node.js                                                           | Long-lived server process; spawns agent subprocesses          |
| Client framework    | **Pi-Studio: React 19 + Vite (DOM)** — web + Electron only (reference app uses Expo/React-Native-Web for iOS/Android/web) | Mobile dropped; see the render-stack note below |
| Desktop wrapper     | Electron                                                          | Bundles + manages its own daemon subprocess; wraps the Vite web build |
| CLI                 | Commander.js                                                      | Docker-style commands; same WS protocol                       |
| Transport           | WebSocket (JSON text frames + small binary framing)               | Direct, via relay, or tunneled through SSH in Electron        |
| Relay crypto        | Curve25519 ECDH + XSalsa20-Poly1305 (NaCl `box`), libsodium       | Zero-knowledge relay                                          |
| Persistence         | File-based JSON under `$PI_STUDIO_HOME`                           | Zod-validated, atomic temp-file rename; no DB, no migrations  |
| Package manager     | npm workspaces (monorepo)                                         | Cross-package generated `.d.ts` declarations                  |
| Lint/format         | oxlint / oxfmt                                                    |                                                               |
| Styling (app)       | **Pi-Studio: CSS custom properties (theme tokens) + CSS Modules** (reference app uses Unistyles) | Same token vocabulary; DOM medium |
| Build (web/desktop) | **Pi-Studio: Vite** (`VITE_TARGET=web`/`electron`); runtime `getIsElectron()` + guarded dynamic `import()` replace Metro `.web`/`.native`/`.electron` extensions |                                                               |
| Website             | TanStack Router + Cloudflare Workers                              | Marketing/docs (`pi-studio.sh`), out of scope here            |

> **Render-stack decision (Pi-Studio).** The reference app is a cross-platform Expo / React-Native-Web
> codebase. Pi-Studio ships **web + Electron only (no iOS/Android)** and therefore renders its UI on a
> **React 19 + Vite DOM** stack: `View`/`Text` → `div`/`span`, Unistyles → CSS custom properties + CSS
> Modules, expo-router → `react-router`, Metro platform extensions → `getIsElectron()` + build-time
> `VITE_TARGET` + guarded dynamic `import()`. The visual language, theme tokens, six variants, screens,
> and interactions are preserved (UI/UX mirrors the reference). The sprint 012–016 UI **logic** is
> framework-agnostic view models; sprints 017–022 are the DOM **render layer**. See
> [architecture/design-system.md](architecture/design-system.md) § UI technology stack and
> [architecture/client-app-runtime.md](architecture/client-app-runtime.md) § Platform rules.

Runtime requirement: the Pi agent CLI installed and authenticated by the user. The daemon
defaults to listening on `127.0.0.1:6767`; `$PI_STUDIO_HOME` defaults to `~/.pi-studio`.

### Backend dependency policy

The daemon prefers small, well-scoped third-party libraries over hand-rolled equivalents where they
improve correctness or operability, and is **not** restricted to pure-JS dependencies. Adopted
backend libraries (mirroring the reference daemon's stack):

| Concern                  | Library                                                     | Why                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PTY terminals            | **`node-pty`** (native)                                     | Real TTY: `isatty`, SIGWINCH on resize, full-screen apps (vim/htop) work. Falls back to a piped `child_process` backend when the native module is unavailable. |
| Terminal screen model    | **`@xterm/headless`**                                       | Server-side grid for screen-accurate `capture` (cursor moves / clears / redraws).                                                                              |
| Process teardown         | **`tree-kill`**                                             | Kill the whole PTY / agent process tree so dev servers and helpers don't orphan.                                                                               |
| Binary resolution        | **`which`**                                                 | Cross-platform `$PATH` lookup (honors Windows PATHEXT) for shells/providers.                                                                                   |
| Output sanitization      | **`strip-ansi`**                                            | Clean captured terminal text.                                                                                                                                  |
| Logging                  | **`pino`** + **`pino-pretty`** + **`rotating-file-stream`** | Structured leveled logs; pretty in dev, rotating NDJSON to `$PI_STUDIO_HOME/logs/` for the daemon.                                                             |
| Bounded growth / fan-out | **`lru-cache`**, **`p-limit`**                              | Bounded caches (download tokens) + capped concurrency for multi-workspace I/O.                                                                                 |

Crypto stays pure-JS (`tweetnacl`); `bcryptjs` and `ws` are unchanged. `node-pty` is the one native
module and ships prebuilt binaries for common platforms.

## 3. High-Level Architecture

```
   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
   │  Mobile App  │   │   Web App    │   │ Desktop App  │   │     CLI      │
   │   (Expo RN)  │   │  (browser)   │   │  (Electron)  │   │ (Commander)  │
   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
          │                  │                  │ (also spawns      │
          │   WebSocket (direct on LAN, via E2EE relay, or Electron SSH tunnel) │
          └──────────────────┴───────┬──────────┴──────────────────────────────┘
                                      │
                              ┌───────▼────────┐        outbound, E2EE
                              │     Daemon     │◄──────────────────────┐
                              │   (Node.js)    │                       │
                              └───────┬────────┘                 ┌─────┴─────┐
        ┌──────────────┬─────────────┼──────────────┬───────────┤   Relay   │
        │              │             │              │           └───────────┘
   ┌────▼───┐    ┌─────▼────┐  ┌─────▼─────┐   ┌────▼─────┐   (zero-knowledge
   │  Pi    │    │ Timeline │  │ Terminals │   │   MCP    │    bridge for remote
   │ Agent  │    │  Store   │  │  (PTY)    │   │  Server  │    access)
   └────┬───┘    └──────────┘  └───────────┘   └──────────┘
        │ child process (RPC)
   ┌────▼──────────────────────────────────────────────┐
   │ Pi agent  (pi --mode rpc)                           │
   │ (+ in-process mock provider for tests)              │
   └─────────────────────────────────────────────────────┘

                File-based JSON state under $PI_STUDIO_HOME
```

- **Daemon** — Source of truth. Spawns/supervises agent sessions, owns the canonical timeline,
  exposes the WebSocket API, runs the MCP server, manages terminals/workspaces/git, optionally
  dials a relay. (`packages/server`)
- **Protocol** — Shared wire schemas, binary frame codecs, endpoint parsing, provider manifest,
  capability flags. Depended on by everyone; depends on no one. (`packages/protocol`)
- **Client** — Low-level daemon WebSocket driver + higher-level `Pi-StudioClient` SDK facade used by
  the web client and CLI. (`packages/client`)
- **Web Client** — Production React/Vite browser UI; manages saved host connections, sessions,
  timeline reducers, composer, file explorer, git changes, terminal. (`packages/web-client`)
- **CLI** — Terminal client; can also start/manage a local daemon. (`packages/cli`)
- **Desktop** — Electron shell that bundles + supervises a daemon and embeds the web app, with
  native file dialogs, menus, auto-update, in-app browser webviews. (`packages/desktop`)
- **Relay** — E2EE bridge for remote access. Client and daemon channels with identical API.
  (`packages/relay`)
- **SSH gateway** — Electron-only SSH local-port tunnel to a remote daemon's localhost WebSocket
  listener; keeps the daemon protocol unchanged. (`packages/desktop`, app runtime integration)
- **Highlight** — Syntax highlighting support package (server-side). (`packages/highlight`)

## 4. Directory / Module Map

| Path                                                                              | Responsibility                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/server/src/server/bootstrap.ts`                                         | Daemon init: HTTP server, WS server, agent manager, storage, relay |
| `packages/server/src/server/websocket-server.ts`                                  | WS connection mgmt, hello handshake, binary frame routing          |
| `packages/server/src/server/session.ts`                                           | Per-client session state, subscriptions, terminal ops              |
| `packages/server/src/server/agent/agent-manager.ts`                               | Agent lifecycle state machine, timeline tracking, subscribers      |
| `packages/server/src/server/agent/agent-storage.ts`                               | File-backed agent JSON persistence                                 |
| `packages/server/src/server/agent/agent-timeline-store.ts`                        | Append-only timeline rows + sequence numbers + paging              |
| `packages/server/src/server/agent/mcp-server.ts`                                  | MCP server tools for agent orchestration                           |
| `packages/server/src/server/agent/providers/`                                     | Pi provider adapter (+ in-process mock for tests)                  |
| `packages/server/src/server/agent/provider-manifest.ts`                           | Provider/mode UI metadata + definitions                            |
| `packages/server/src/server/agent/provider-registry.ts`                           | Provider client factories                                          |
| `packages/server/src/server/relay-transport.ts`                                   | Outbound relay connection with E2EE                                |
| `packages/server/src/server/schedule/`                                            | Cron-based scheduled agents                                        |
| `packages/server/src/server/loop-service.ts`                                      | Looping agent runs with verifiers                                  |
| `packages/server/src/server/chat/`                                                | Chat rooms for agent↔agent / human↔agent messaging                 |
| `packages/server/src/server/checkout/`, `workspace-git-service.ts`                | Git status/diff/branch/PR operations                               |
| `packages/server/src/server/worktree/`, `pi-studio-worktree-service.ts`           | Pi-Studio-managed git worktrees                                    |
| `packages/server/src/server/workspace-registry.ts`, `*-reconciliation-service.ts` | Project/workspace registries                                       |
| `packages/server/src/server/service-proxy.ts`, `script-proxy.ts`                  | HTTP proxy to workspace services                                   |
| `packages/server/src/server/file-explorer/`, `file-download/`, `file-upload/`     | File browsing + transfer                                           |
| `packages/server/src/terminal/`                                                   | PTY terminal manager (worker process), capture, restore            |
| `packages/protocol/src/messages.ts`                                               | All WebSocket message Zod schemas                                  |
| `packages/protocol/src/binary-frames/`, `terminal-stream-protocol.ts`             | Binary frame codecs                                                |
| `packages/protocol/src/client-capabilities.ts`                                    | Client capability flag constants                                   |
| `packages/client/src/daemon-client.ts`                                            | Low-level WS driver                                                |
| `packages/client/src/index.ts`                                                    | `Pi-StudioClient` SDK facade                                       |
| `packages/web-client/src/`                                                        | React/Vite browser client (features, stores, timeline, workspace) |
| `packages/cli/src/commands/`                                                      | CLI command tree                                                   |
| `packages/desktop/src/`                                                           | Electron main/preload, daemon supervision, features                |
| `packages/relay/src/`                                                             | E2EE channels, crypto, Cloudflare adapter                          |

## 5. Data Model Overview

All server state is **file-based JSON under `$PI_STUDIO_HOME`** (default `~/.pi-studio`), validated with
Zod, written atomically (temp file + rename) except where noted. No migration framework — forward
compatibility via optional fields + defaults + small inline normalization.

```
Project (1) ──< (N) Workspace ──< (N) Agent
   │                  │                 │ (pi-studio.parent-agent-id label)
   │                  │                 └──< (N) Agent (subagent, cascade-archived)
   │                  └── cwd, git state, workspaceKind
   └── rootPath, git remote → projectKey

Agent ── timeline rows (append-only, epoched, sequence-numbered)
Agent ── PersistenceHandle (provider session resume)
Schedule ──< (N) ScheduleRun ── targets agent or new-agent
Loop ──< (N) LoopIteration ── worker agent + optional verifier agent
ChatRoom (1) ──< (N) ChatMessage (with @mentions)
Terminal (PTY) ── workspace-scoped, binary stream
```

Key files on disk:

```
$PI_STUDIO_HOME/
├── config.json                        # Daemon config (mutable, Zod-validated)
├── server-id                          # Stable daemon id "srv_<base64url>"
├── daemon-keypair.json                # E2EE relay keypair (mode 0600)
├── pi-studio.pid                          # PID lock
├── daemon.log                         # Rotating logs
├── agents/{sanitized-cwd}/{id}.json   # One file per agent (record + timeline rows)
├── schedules/{id}.json                # One file per schedule
├── loops/loops.json                   # All loops (non-atomic, queued)
├── chat/rooms.json                    # All rooms + messages
├── projects/projects.json             # Project registry
└── projects/workspaces.json           # Workspace registry
```

Full per-entity schemas are in [architecture/persistence.md](architecture/persistence.md). The agent
record, schedule, loop, chat, project, workspace shapes are reproduced there as field tables.

## 6. External Integrations & Configuration

| Integration | Purpose                                     | Protocol/SDK           | Notes                                                                                        |
| ----------- | ------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| Pi          | Provider (the only agent provider in scope) | `pi --mode rpc`        | Process-backed; `--append-system-prompt`, `--mcp-config`; reads JSONL session dir for import |
| GitHub      | PR/issue attach, PR create/merge            | `gh` CLI / GitHub API  | `services/github-service.ts`                                                                 |
| Relay       | Remote access                               | WebSocket + NaCl box   | Hosted or self-hosted (Go impl available)                                                    |
| SSH gateway | Desktop remote access via existing SSH host | SSH direct-tcpip tunnel | Electron-only; daemon remains bound to remote `127.0.0.1:6767`; see `architecture/ssh-gateway-connections.md` |
| MCP clients | Agent-to-agent control                      | Model Context Protocol | **Not implemented.** `agent/mcp-server.ts` holds a tool registry (17 tools) but nothing serves `/mcp/agents`, no `McpBackend` is implemented, no `daemon.mcp` config exists, and no spawned agent receives `--mcp-config` — so agents cannot reach it and `features/subagents.md` orchestration has never run |

### Configuration surface (selected env vars)

| Env var / key                                                | Required | Purpose                                            | Default                                 |
| ------------------------------------------------------------ | -------- | -------------------------------------------------- | --------------------------------------- |
| `PI_STUDIO_HOME`                                             | No       | State directory                                    | `~/.pi-studio`                          |
| `PI_STUDIO_LISTEN`                                           | No       | Daemon listen address                              | `127.0.0.1:6767`                        |
| `PI_STUDIO_SERVER_ID`                                        | No       | Override stable daemon id                          | generated                               |
| `PI_STUDIO_PASSWORD`                                         | No       | Shared-secret daemon password (bcrypt-hashed)      | none                                    |
| `PI_STUDIO_HOSTNAMES`                                        | No       | Host header allowlist (comma-sep; `true` disables) | `localhost`, `*.localhost`, literal IPs |
| `PI_STUDIO_PI_HOME`                                           | No       | Redirect the bundled Pi CLI's own `.pi` config dir | `~/.pi` (Pi CLI's own default)          |
| `PI_STUDIO_RELAY_ENDPOINT`                                   | No       | Relay internal endpoint                            | —                                       |
| `PI_STUDIO_RELAY_PUBLIC_ENDPOINT`                            | No       | Relay client-facing endpoint                       | —                                       |
| `PI_STUDIO_RELAY_USE_TLS` / `PI_STUDIO_RELAY_PUBLIC_USE_TLS` | No       | Relay TLS                                          | `false`                                 |
| `PI_STUDIO_SERVICE_PROXY_LISTEN`                             | No       | Service proxy listener                             | —                                       |
| `PI_STUDIO_SERVICE_PROXY_PUBLIC_BASE_URL`                    | No       | Public service aliases                             | —                                       |

Config file `config.json` (`PersistedConfigSchema`) holds daemon listen/auth/relay/cors/mcp,
provider overrides (`agents.providers`), logging, worktree root, and `app.baseUrl`. Per-project `pi-studio.json` holds worktree `setup`/`teardown` commands and named
`scripts` (including `type: "service"` entries). See
[architecture/config.md](architecture/config.md).

## 7. Build / Run / Test / Deploy

- **Install:** `npm install` at repo root (npm workspaces). Patches applied via postinstall.
- **Run (dev):** `npm run dev` (daemon on `127.0.0.1:6768`), `npm run dev:app` (Expo),
  `npm run dev:desktop` (Electron). Repo dev state lives under `.dev/pi-studio-home`.
- **Run (prod):** desktop app auto-starts a bundled daemon; or `npm install -g @av-pi-studio/cli` then
  `pi-studio` / `pi-studio daemon start` (on `127.0.0.1:6767`).
- **Build:** layered — `build:protocol` → `build:client` → `build:server` (also builds highlight,
  relay, cli). Always build owning packages before diagnosing cross-package type errors.
- **Test:** Vitest per-file (`npx vitest run <file>`). Maestro for mobile. Never run the whole suite
  locally; use CI.
- **Deploy:** desktop via Electron release + EAS for mobile; npm publish for daemon/CLI packages
  (`release:*` scripts); website on Cloudflare.

## 8. Sub-Scope Index

### Features

| Scope file                                                               | Kind         | Description                                                                   |
| ------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------- |
| [features/agent-sessions.md](features/agent-sessions.md)                 | feature      | Create/run/stop/resume agents; prompts, modes, models, thinking, attachments  |
| [features/agent-providers.md](features/agent-providers.md)               | feature      | Pi provider adapter, modes/models/features, configuration                     |
| [features/timeline-streaming.md](features/timeline-streaming.md)         | feature      | Append-only timeline, live stream, authoritative paged catch-up sync          |
| [features/tool-output-streaming.md](features/tool-output-streaming.md)   | feature      | Live in-flight tool output: ephemeral coalesced `tool_call` partial snapshots (+ small protocol amendment) |
| [features/tool-permissions.md](features/tool-permissions.md)             | feature      | Tool-call permission request/approve/deny flow                                |
| [features/projects-workspaces.md](features/projects-workspaces.md)       | feature      | Project/workspace registries, reconciliation, open-project                    |
| [features/worktrees.md](features/worktrees.md)                           | feature      | Pi-Studio-managed git worktrees, setup/teardown, auto-archive                 |
| [features/git-checkout.md](features/git-checkout.md)                     | feature      | Git status/diff/branch/commit/push/pull/stash + GitHub PRs                    |
| [features/terminals.md](features/terminals.md)                           | feature      | Workspace PTY terminals over binary stream protocol                           |
| [features/chat-rooms.md](features/chat-rooms.md)                         | feature      | Agent↔agent / human↔agent chat with @mentions                                 |
| [features/schedules-heartbeats.md](features/schedules-heartbeats.md)     | feature      | Cron/interval scheduled agents and heartbeats                                 |
| [features/loops.md](features/loops.md)                                   | feature      | Iterative agent loops with shell + LLM verifiers                              |
| [features/mcp-server.md](features/mcp-server.md)                         | feature      | MCP tools exposing the daemon to agents                                       |
| [features/service-proxy.md](features/service-proxy.md)                   | feature      | HTTP proxy to workspace dev services with generated hostnames                 |
| [features/file-explorer-transfer.md](features/file-explorer-transfer.md) | feature      | File browser + download/upload binary streams                                 |
| [features/file-explorer-move.md](features/file-explorer-move.md)         | feature      | Move/rename files and directories, explorer drag-and-drop                     |
| [features/subagents.md](features/subagents.md)                           | feature      | Parent/child agents, subagents track, cascade archive                         |
| [features/cli.md](features/cli.md)                                       | feature      | Commander.js CLI command surface                                              |
| [features/provider-auth-cli.md](features/provider-auth-cli.md)           | feature      | `pi-studio auth` login/status/logout reusing Pi's ModelRuntime locally (no daemon) |
| [features/provider-auth-rpc.md](features/provider-auth-rpc.md)           | feature      | Daemon-side provider auth RPCs: list/login/respond/cancel/logout + flow-event push |
| [features/extension-ui-rpc.md](features/extension-ui-rpc.md)             | feature      | Daemon-side generic `agent_ui_*` bridge for Pi extension UI (dialogs, retained widget/status surfaces) |
| [features/connection-resilience.md](features/connection-resilience.md)   | feature      | Background-tab reconnect (worker timers), resume triggers, stale-socket probe |
| [features/preinstalled-extensions.md](features/preinstalled-extensions.md) | feature      | Curated Pi extension packs auto-installed/updated by the daemon (additive-only sync) |
| [features/desktop-app.md](features/desktop-app.md)                       | feature      | Electron shell: daemon supervision, windows, browser panes, updates           |
| [features/app-navigation-screens.md](features/app-navigation-screens.md) | feature (UI) | Route map, navigation shell, onboarding/pairing, settings/projects IA         |
| [features/workspace-ui.md](features/workspace-ui.md)                     | feature (UI) | Workspace screen, tab model, pane/split layout, headers, draft seeding        |
| [features/workspace-split-panes.md](features/workspace-split-panes.md)   | feature (UI) | Drag-a-tab-to-split panes: drop regions, resize, per-workspace persistence     |
| [features/timeline-rendering.md](features/timeline-rendering.md)         | feature (UI) | Per-row rendering, tool-call cards, diffs, markdown, autoscroll, footers      |
| [features/inline-image-rendering.md](features/inline-image-rendering.md) | feature (UI) | Markdown images in chat resolved from local paths + capability-gated agent instruction |
| [features/file-link-rendering.md](features/file-link-rendering.md)     | feature (UI) | Markdown file links in chat opened as an actionable file-tab dispatch + drag-to-split, capability-gated agent instruction |
| [features/mermaid-diagram-rendering.md](features/mermaid-diagram-rendering.md) | feature (UI) | Fenced `mermaid` code blocks in chat rendered as live diagrams, capability-gated agent instruction |
| [features/composer-ui.md](features/composer-ui.md)                       | feature (UI) | Composer regions, submit/queue, autocomplete, controls, attachments, voice    |
| [features/feature-panels-ui.md](features/feature-panels-ui.md)           | feature (UI) | File explorer/preview, git diff/PR/review, terminal, browser, subagents track |
| [features/html-file-preview.md](features/html-file-preview.md)           | feature (UI) | HTML files previewed in a sandboxed iframe; descriptor-driven file-viewer registry; workspace-confined local asset inlining |
| [features/ui-components.md](features/ui-components.md)                   | feature (UI) | Shared primitives: pressables, inputs, overlays, headers, feedback            |
| [features/rewind.md](features/rewind.md)                                 | feature (UI) | Rewind conversation/files/both to a prior message (+ small protocol amendment) |
| [features/provider-usage.md](features/provider-usage.md)                 | feature (UI) | Per-provider spend/quota balances + rate-limit windows (+ small protocol amendment) |
| [features/provider-auth-ui.md](features/provider-auth-ui.md)             | feature (UI) | Client SDK login-flow methods + settings dialog shell (Model Providers category), login dialog, onboarding nudge |
| [features/keyboard-shortcuts.md](features/keyboard-shortcuts.md)         | feature (UI) | Global shortcut registry, focus-scope dispatch, customizable overrides        |
| [features/localization.md](features/localization.md)                     | feature (UI) | i18next-based multi-language UI, live language switching                      |
| [features/white-label-branding.md](features/white-label-branding.md)     | feature (UI) | Build-time brand config: product name/title, accent colors, logo/icons        |

### Architecture

| Scope file                                                                     | Kind         | Description                                                                   |
| ------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------- |
| [architecture/daemon-bootstrap.md](architecture/daemon-bootstrap.md)           | architecture | Daemon startup, PID lock, server id, shutdown                                 |
| [architecture/websocket-protocol.md](architecture/websocket-protocol.md)       | architecture | Wire envelopes, handshake, RPC namespacing, capability gating, compat rules   |
| [architecture/relay-e2ee.md](architecture/relay-e2ee.md)                       | architecture | Relay transport, ECDH/NaCl box encryption, pairing                            |
| [architecture/persistence.md](architecture/persistence.md)                     | architecture | File-based JSON stores, Zod schemas, atomic writes, all entity shapes         |
| [architecture/auth-security.md](architecture/auth-security.md)                 | architecture | Password auth, host allowlist, CORS, DNS rebinding, trust boundaries          |
| [architecture/agent-lifecycle.md](architecture/agent-lifecycle.md)             | architecture | Lifecycle state machine, archive (soft delete), cascade                       |
| [architecture/config.md](architecture/config.md)                               | architecture | `config.json`, `pi-studio.json`, env-var precedence, provider overrides       |
| [architecture/client-app-runtime.md](architecture/client-app-runtime.md)       | architecture | Host runtime controller, session context, reconnection, platform gating       |
| [architecture/design-system.md](architecture/design-system.md)                 | architecture | Theme tokens, six theme variants, breakpoints, styling-engine rules, overlays |
| [architecture/structured-generation.md](architecture/structured-generation.md) | architecture | Daemon-side metadata generation (titles, commit messages, branch names)       |

## 9. Cross-Cutting Conventions

- **Validation:** every wire and disk boundary parses through Zod; invalid input is rejected or
  defaulted, never trusted.
- **Protocol compatibility (always):** schemas are append-only. New fields are optional with
  defaults/transforms. Never flip optional→required, remove fields, or narrow types. A 6-month-old
  client must still parse new-daemon messages and vice versa.
- **Feature compatibility (per-feature):** new capabilities are advertised in
  `server_info.features.*`; clients detect the flag and either run the feature or show "update the
  host." No degraded fallback paths.
- **Back-compat shims** are tagged `COMPAT(name)` with version + removal date; one grep lists all
  cleanup work.
- **RPC naming:** new session RPCs use dotted namespaces with direction suffixes
  (`domain.provider.operation.request` / `.response`), correlated by `requestId`. Legacy flat names
  remain accepted.
- **Errors:** RPC failures surface as `rpc_error` correlated by `requestId`; operation timeouts are
  not treated as socket death (liveness uses the top-level `ping`/`pong` envelope).
- **Timestamps:** timeline row timestamps are canonical daemon-owned; clients must not apply local
  clock heuristics.
- **Platform gating (app):** cross-platform by default; gate with `isWeb`/`isNative`/
  `getIsElectron()`/`useIsCompactFormFactor()` or Metro file extensions. Hover only works on web.

## 10. Open Questions — TODO(verify)

- [ ] Exact set of WebSocket message types is large; sub-scopes enumerate the principal ones but
      the full union in `packages/protocol/src/messages.ts` should be cross-checked when
      reimplementing the wire layer.
- [ ] Precise capability-flag floor versions and `COMPAT(...)` removal dates change over time;
      verify against the current `ServerInfoStatusPayloadSchema` and `CLIENT_CAPS`.
- [ ] The Pi session file format / session dir is version-sensitive; verify the current layout
      against the live Pi CLI.
- [ ] Replay protection within a live relay session is not implemented (random nonces, no counter);
      confirm this is still the case before relying on it.
- [ ] Window-state persistence and per-window browser panes in desktop are v1-limited; confirm
      current scope before reimplementing multi-window.
