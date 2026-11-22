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
| Relay crypto        | Curve25519 ECDH + XSalsa20-Poly1305 (NaCl `box`), tweetnacl       | Zero-knowledge relay                                          |
| Persistence         | File-based JSON under `$PI_STUDIO_HOME`                           | Zod-validated, atomic temp-file rename; no DB, no migrations  |
| Package manager     | npm workspaces (monorepo)                                         | Cross-package generated `.d.ts` declarations                  |
| Lint/format         | oxlint / oxfmt                                                    |                                                               |
| Styling (app)       | **Pi-Studio: CSS custom properties (theme tokens) + CSS Modules** (reference app uses Unistyles) | Same token vocabulary; DOM medium |
| Build (web/desktop) | **Pi-Studio: Vite**, one `web` target (`dist/web`). The build-target switch and its `electron` target were removed 2026-11-14; the desktop client (Tauri, separate repo) consumes `@av-pi-studio/workbench` |                                                               |
| Website             | TanStack Router + Cloudflare Workers                              | Marketing/docs (`pi-studio.sh`), out of scope here            |

> **Render-stack decision (Pi-Studio).** The reference app is a cross-platform Expo / React-Native-Web
> codebase. Pi-Studio ships **web + Electron only (no iOS/Android)** and therefore renders its UI on a
> **React 19 + Vite DOM** stack: `View`/`Text` → `div`/`span`, Unistyles → CSS custom properties + CSS
> Modules, expo-router → `react-router`, Metro platform extensions → (historically) `getIsElectron()` +
> a build-time target flag + guarded dynamic `import()`. The visual language, theme tokens, six variants, screens,
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
| Bounded growth / fan-out | **`lru-cache`**, **`p-limit`**                              | Bounded caches + capped concurrency for multi-workspace I/O.                                                                                                   |

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
- **Web Client** — The browser shell: a thin Vite SPA that renders the workbench with a browser host
  (build-time brand title/favicon, pdf.js worker). Ships the static `dist/web` that `pi-studio ui` and the
  Docker image serve. (`packages/web-client`)
- **UI Library** — Publishable React design system extracted from the web client: primitives,
  theme/tokens/appearance, accent-only brand injection, one prebuilt stylesheet. Depends on no
  workspace package; see `swe/grills/ui-library.md`. (`packages/ui-library`)
- **UI Gallery** — Private Vite+React gallery app that renders every primitive family against the
  built ui-library `dist` across all six themes; never published or deployed. (`packages/ui-gallery`)
- **Workbench** — *Built (sprints 091–094, release wiring in 095; first npm release with the merge of `feat/workbench`).*
  Publishable library holding the application itself (connection, sessions, chat/timeline, composer,
  files and viewers, git, terminals, settings; features, stores, reducers) behind a host adapter, so
  the browser shell and the desktop app share one UI; see `architecture/workbench-package.md` and
  `architecture/workbench-host-adapter.md`. (`packages/workbench`)
- **CLI** — Terminal client; can also start/manage a local daemon. (`packages/cli`)
- **Desktop** — Native shell around the same UI. *Direction changed 2026-11-14:* built as a Tauri
  app with a Rust backend in a separate repository (`pi-studio-desktop`), consuming the workbench
  from npm; see `docs/desktop-client-handoff.md`. The Electron shell described in
  `features/desktop-app.md` was never built in this repository (`packages/desktop` does not exist).
- **Relay** — E2EE bridge for remote access. Client and daemon channels with identical API.
  (`packages/relay`)
- **SSH gateway** — Electron-only SSH local-port tunnel to a remote daemon's localhost WebSocket
  listener; keeps the daemon protocol unchanged. (`packages/desktop`, app runtime integration)

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
| `packages/server/src/daemon/relay-transport.ts`                                   | Outbound relay connection (control + per-client data sockets)      |
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
| `packages/workbench/src/`                                                         | The client application (features, stores, timeline, workspace, host adapter, shell components) |
| `packages/web-client/src/`                                                        | Browser shell: `main.tsx`, brand override, build config |
| `packages/cli/src/commands/`                                                      | CLI command tree                                                   |
| _(separate repo `pi-studio-desktop`)_                                              | Tauri + Rust desktop app; consumes `@av-pi-studio/workbench` (`docs/desktop-client-handoff.md`) |
| `packages/relay/src/`                                                             | Relay server, E2EE channel, control frames, session id             |

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
| Relay       | Remote access                               | WebSocket + NaCl box   | Self-hosted (`packages/relay`, Node)                                                         |
| SSH gateway | Desktop remote access via existing SSH host | SSH direct-tcpip tunnel | **Not built.** Desktop app only (the Tauri client, desktop milestone 4; the owner's decisions of 2026-11-21 are at the top of `architecture/ssh-gateway-connections.md`, whose body was written for the Electron plan); daemon remains bound to remote `127.0.0.1:6767` |
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
- **Build:** layered — `build:protocol` → `build:client` → `build:server` (also builds relay, cli).
  Always build owning packages before diagnosing cross-package type errors.
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
| [features/tool-permissions.md](features/tool-permissions.md)             | feature      | **Retired (sprint-086)** — tool-call permission flow                                |
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
| [features/extensions-manager.md](features/extensions-manager.md)         | feature      | Settings-panel Extensions manager: render curated-pack status/sync (existing RPCs); Phase B `pi_packages_*` superseded by architecture/pi-resource-management.md |
| [features/skills-manager.md](features/skills-manager.md)                 | feature      | Settings → Skills: list/enable/disable/remove/install/update-all Pi skills (npm/git packages skills-only, Agent Skills repos, host paths) |
| [features/self-update.md](features/self-update.md)                       | feature      | In-UI daemon self-update: toolbar indicator, Settings → Update panel, npm install + `pi update --extensions` + unattended daemon restart |
| [features/desktop-app.md](features/desktop-app.md)                       | feature      | **Superseded (2026-11-14)** — Electron shell: daemon supervision, windows, browser panes, updates. Desktop is now a Tauri app in a separate repository; see `docs/desktop-client-handoff.md` |
| [features/desktop-client-protocol-followups.md](features/desktop-client-protocol-followups.md) | feature      | Additive protocol work the desktop client needs: `hello.platform`, paced file transfer with an upload completion push, fixtures for file transfer and terminals (incl. binary frames) — **shipped (sprint-096; first carried by 0.0.118)** |
| [features/desktop-client-protocol-followups-2.md](features/desktop-client-protocol-followups-2.md) | feature      | Second round for the desktop client: download by path with ranges, size, resume validator and cancel (the download token is **removed**), `hello.agentStreams` (`all`/`none`), `--json` on `daemon start/restart/pair/stop`, fixtures `formatVersion` 2 — **shipped (sprints 097 and 098, 2026-11-15; first carried by 0.0.119)** |
| [features/relay-multi-client.md](features/relay-multi-client.md) | feature      | Several clients per daemon through the relay, with transfer parity: one daemon socket per client piped by the relay, binary frames, backpressure, message counters on the NaCl box, refusal reasons, fixed-key fixtures; hard cut, pairing unchanged — **built (sprints 099–101, 2026-11-15); ships with the next release after 0.0.120** |
| [features/desktop-native-host.md](features/desktop-native-host.md) | feature      | Desktop milestone 1, part 1: a desktop `WorkbenchHost` (settings and per-daemon state in Rust-owned files, native confirm/alert, external links, save to disk through a native dialog, HTML preview on its own origin), in-app session rename for both clients, and removal of the template's sample from the Rust side — **built on `feat/desktop-client` (sprints 102–106), checked live on Linux 2026-11-20; every criterion ticked on Linux evidence but the OS file drag; macOS and Windows not run** |
| [features/desktop-daemon-registry.md](features/desktop-daemon-registry.md) | feature      | Desktop milestone 1, part 2: a daemon registry owned by Rust (local, direct, relay entries), switching from the native menu and the connection bar, a Daemons screen, and supervision of this machine's daemon through an installed `pi-studio` CLI — **built (sprints 107–111, merged), checked live on Linux 2026-11-20 and by the automated checks on macOS and Windows; 15 of 17 criteria ticked, two open (a real version manager and a Dock launch, `wrong_key` live); desktop milestone 1 done for Linux** |
| [features/desktop-transport-bridge.md](features/desktop-transport-bridge.md) | feature      | Desktop milestone 2: the socket to the daemon of a local or direct entry moves into Rust behind `connection.createTransport` (relay entries stay on the webview's socket), secrets move to the OS keychain, and Rust signals wake and network changes; started with an IPC benchmark that was a gate — **built and checked 2026-11-22 (sprints 112–117): the gate failed for a bridge over Tauri's channel, the owner chose a loopback WebSocket proxy owned by Rust (decision T5), and it is built and checked on Linux and on the macOS and Windows runners; open: a real-machine sleep, an unsigned macOS build's keychain prompts, a firewall prompt and the upload's `bufferedAmount` pause on Windows (`notes/desktop-ipc-benchmark.md`, `desktop/docs/platform-checks.md`)** |
| [features/desktop-transfer-engine.md](features/desktop-transfer-engine.md) | feature      | Desktop milestone 3: uploads (from a native picker) and saves to disk run in Rust on a second, quiet connection to the daemon of a local or direct entry, up to three at once, with recovery after a dropped connection; the explorer shows a line per activity with a percentage and Cancel, in the browser client too; the daemon writes an upload to a temporary file, renames it when complete, and paces it — **specified 2026-11-22 from the grill `grills/desktop-transfer-engine.md` (D1–D20, S1–S12), revised for the owner's no-compatibility rule (R1–R4); planned as sprints 118–123; nothing built** |
| [features/app-navigation-screens.md](features/app-navigation-screens.md) | feature (UI) | Route map, navigation shell, onboarding/pairing, settings/projects IA         |
| [features/workspace-ui.md](features/workspace-ui.md)                     | feature (UI) | Workspace screen, tab model, pane/split layout, headers, draft seeding        |
| [features/workspace-split-panes.md](features/workspace-split-panes.md)   | feature (UI) | Drag-a-tab-to-split panes: drop regions, resize, per-workspace persistence     |
| [features/timeline-rendering.md](features/timeline-rendering.md)         | feature (UI) | Per-row rendering, tool-call cards, diffs, markdown, autoscroll, footers      |
| [features/inline-image-rendering.md](features/inline-image-rendering.md) | feature (UI) | Markdown images in chat resolved from local paths + capability-gated agent instruction |
| [features/file-link-rendering.md](features/file-link-rendering.md)     | feature (UI) | Markdown file links in chat opened as an actionable file-tab dispatch + drag-to-split, capability-gated agent instruction |
| [features/mermaid-diagram-rendering.md](features/mermaid-diagram-rendering.md) | feature (UI) | Fenced `mermaid` code blocks in chat rendered as live diagrams, capability-gated agent instruction |
| [features/composer-ui.md](features/composer-ui.md)                       | feature (UI) | Composer regions, submit/queue, autocomplete, controls, attachments, voice    |
| [features/composer-path-drop.md](features/composer-path-drop.md)         | feature (UI) | Drag a Files-tree file/folder onto the composer to insert its workspace-relative path at the caret (new composer-only path-ref drag payload) — **shipped (sprint-081)** |
| [features/feature-panels-ui.md](features/feature-panels-ui.md)           | feature (UI) | File explorer/preview, git diff/PR/review, terminal, browser, subagents track |
| [features/html-file-preview.md](features/html-file-preview.md)           | feature (UI) | HTML files previewed in a sandboxed iframe; descriptor-driven file-viewer registry; workspace-confined local asset inlining |
| [features/pdf-file-preview.md](features/pdf-file-preview.md)             | feature (UI) | PDF files rendered in place with pdf.js (lazy pages, text selection, zoom, live refresh); `pdfviewer` viewer-settings toggle, on by default |
| [features/viewer-unbound-tabs.md](features/viewer-unbound-tabs.md)       | feature (UI) | Viewer plugin tabs opened without a file and saved to a new one: host Save-As dialog, tab rebind, exclusive-create write (phase 5 of `docs/MOLVIEWER_DECOUPLING.md`) |
| [features/ui-components.md](features/ui-components.md)                   | feature (UI) | Shared primitives: pressables, inputs, overlays, headers, feedback            |
| [features/conversation-fork.md](features/conversation-fork.md)           | feature      | Fork-based conversation time-travel: post-fork timeline resync (daemon) + transcript fork UI (web) |
| [features/session-tree-navigation.md](features/session-tree-navigation.md) | feature      | Pi `/tree` in the web app: session-tree view + in-place time-travel navigation (Phase 2 gated on an upstream `navigate_tree` Pi RPC) |
| [features/provider-usage.md](features/provider-usage.md)                 | feature (UI) | Per-provider spend/quota balances + rate-limit windows (+ small protocol amendment) |
| [features/context-compaction.md](features/context-compaction.md)         | feature      | Manual `/compact` + status-bar trigger, live `compaction` stream events (manual + auto), context-usage meter bar |
| [features/agent-todos.md](features/agent-todos.md)                       | feature      | Daemon derives the `rpiv-todo` list (live `entry_appended`/`tool_execution_end` + session-file replay) into a typed `agent_todos_*` family (list + broadcast) + SDK — **shipped (sprint-079)** |
| [features/agent-todos-ui.md](features/agent-todos-ui.md)                 | feature (UI) | Read-only, collapsible agent todo panel above the composer in each chat pane — **shipped (sprint-080)** |
| [features/provider-auth-ui.md](features/provider-auth-ui.md)             | feature (UI) | Client SDK login-flow methods + settings dialog shell (Model Providers category), login dialog, onboarding nudge |
| [features/keyboard-shortcuts.md](features/keyboard-shortcuts.md)         | feature (UI) | Global shortcut registry, focus-scope dispatch, customizable overrides        |
| [features/localization.md](features/localization.md)                     | feature (UI) | i18next-based multi-language UI, live language switching                      |
| [features/white-label-branding.md](features/white-label-branding.md)     | feature (UI) | Build-time brand config: product name/title, accent colors, logo/icons        |
| [features/web-ui-agent-deep-link.md](features/web-ui-agent-deep-link.md) | feature (UI) | shipped (sprint-082) — Web UI `#agent=<agentId>` URL-fragment deep link: selects that agent's chat after connect + restore, coexists with `#offer=`, unknown-agent notice |
| [features/daemon-status-rpc.md](features/daemon-status-rpc.md)           | feature      | **Shipped (sprint-084/085).** `daemonObservability` flag: `daemon_status_*` (version, uptime, cpu/mem, event-loop lag, agents by status, connected clients) + 5 s subscribe push |
| [features/daemon-log-streaming.md](features/daemon-log-streaming.md)     | feature      | **Shipped (sprint-085).** `daemon_logs_subscribe/_unsubscribe` + `daemon_log_lines`: pino tap, in-memory tail ≤ 1000, minLevel filter, 200 lines/s cap with dropped counter |

### Architecture

| Scope file                                                                     | Kind         | Description                                                                   |
| ------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------- |
| [architecture/daemon-bootstrap.md](architecture/daemon-bootstrap.md)           | architecture | Daemon startup, PID lock, server id, shutdown                                 |
| [architecture/single-binary-daemon.md](architecture/single-binary-daemon.md)   | architecture | Exploration record (2026-11-22): the daemon, Pi and the CLI as one Bun-compiled executable; what a spike measured, the code changes it needs, release, daemon update and desktop self-update designs, the owner's decisions — **not built, not scheduled** |
| [architecture/websocket-protocol.md](architecture/websocket-protocol.md)       | architecture | Wire envelopes, handshake, RPC namespacing, capability gating, compat rules   |
| [architecture/relay-e2ee.md](architecture/relay-e2ee.md)                       | architecture | Relay transport, ECDH/NaCl box encryption, pairing                            |
| [architecture/relay-protocol.md](architecture/relay-protocol.md)               | architecture | Relay protocol 2: control frames, pairing, close codes, limits, the encrypted channel (key exchange, salt and counter nonce, records) — **built (sprints 099–101, 2026-11-15)**; replaces the wire sections of `relay-e2ee.md` |
| [architecture/persistence.md](architecture/persistence.md)                     | architecture | File-based JSON stores, Zod schemas, atomic writes, all entity shapes         |
| [architecture/auth-security.md](architecture/auth-security.md)                 | architecture | Password auth, host allowlist, CORS, DNS rebinding, trust boundaries          |
| [architecture/agent-lifecycle.md](architecture/agent-lifecycle.md)             | architecture | Lifecycle state machine, archive (soft delete), cascade                       |
| [architecture/config.md](architecture/config.md)                               | architecture | `config.json`, `pi-studio.json`, env-var precedence, provider overrides       |
| [architecture/client-app-runtime.md](architecture/client-app-runtime.md)       | architecture | Host runtime controller, session context, reconnection, platform gating       |
| [architecture/design-system.md](architecture/design-system.md)                 | architecture | Theme tokens, six theme variants, breakpoints, styling-engine rules, overlays |
| [architecture/structured-generation.md](architecture/structured-generation.md) | architecture | Daemon-side metadata generation (titles, commit messages, branch names)       |
| [architecture/viewer-plugin-system.md](architecture/viewer-plugin-system.md) | architecture | Viewer plugin contract/registry/barrel; molviewer as plugin #1 (phase 1 of `docs/MOLVIEWER_DECOUPLING.md`) |
| [architecture/pi-resource-management.md](architecture/pi-resource-management.md) | architecture | Daemon backend over Pi's resolver/settings + pinned `skills` CLI: single `skills_*` family, toggle mirror, stateless preview, FIFO queue, watcher (supersedes extensions-manager Phase B) |
| [architecture/external-client-fixtures.md](architecture/external-client-fixtures.md) | architecture | Canonical JSON fixtures of every wire message external clients (Pi Studio Dashboard) consume + in-process daemon contract test; changing a fixture shape is a breaking change — **shipped (sprint-083)** |
| [architecture/workbench-package.md](architecture/workbench-package.md) | architecture | `@av-pi-studio/workbench`: the application moved out of `web-client` into a prebuilt library (whole app + shell regions), `web-client` reduced to a browser shell, `electron` target removed — **shipped (sprints 091, 092, 094, 095; released with the merge of `feat/workbench`)** |
| [architecture/workbench-host-adapter.md](architecture/workbench-host-adapter.md) | architecture | The one object a shell supplies to the workbench: storage, clipboard, dialogs, links, launch intent, transport factory, reconnect timing, file transfer, pdf.js runtime, and (sprints 103–110) HTML preview origin, daemon registry, save target; `createBrowserHost` reproduces today's behaviour — **shipped (sprint-093); extended and checked on Linux for the desktop host (sprints 103–110)** |

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
- [x] Replay protection within a live relay session: closed by relay protocol 2 (counter nonces,
      strict order, daemon-chosen salt; a second client no longer evicts the first) — see
      [architecture/relay-protocol.md](architecture/relay-protocol.md).
- [ ] Window-state persistence and per-window browser panes in desktop are v1-limited; confirm
      current scope before reimplementing multi-window.
- [x] Skills manager backend: whether `pi install` preserves an existing same-identity entry's
      filter arrays — see
      [architecture/pi-resource-management.md § TODO(verify)](architecture/pi-resource-management.md).
      **Resolved (sprint-077/task-001): it preserves them** — only `source` is rewritten.
- [x] Agent todos, daemon half: Pi RPC frames, `getBranch()` entries, settle ordering and nested/sub-agent
      events — see [features/agent-todos.md § TODO(verify)](features/agent-todos.md).
      **Resolved (sprint-079/task-001): verified against Pi 1.4.0 + rpiv-todo 2.15.0**; nested
      `ctx.executeTool` calls are same-session and are accepted (`parentToolCallId` is not a child list);
      Pi also emits `entry_appended` for every state change, which the adapter uses alongside
      `tool_execution_end`.
- [x] Agent todos, UI half: persistence slot (sibling localStorage record) and visual sign-off (given)
      ([features/agent-todos-ui.md](features/agent-todos-ui.md)).
- [x] Composer path drop shipped (sprint-081): `execCommand('insertText')` spike (Chromium), pane
      focus on drop and the never-focused-caret rule resolved — see
      [features/composer-path-drop.md § TODO(verify)](features/composer-path-drop.md).
- [ ] Composer path drop, still open: Firefox and Safari checks of native undo (not run; no such
      browser was available), and the `relativeToRoot` sibling-prefix bug (also affects the tree's
      *Copy Relative Path*).
- [x] Daemon `listen` default bug: `packages/server/src/daemon/main.ts` defaults `listen` to
      `0.0.0.0:6767` while `config/daemon-config.ts`, `daemon/index.ts` and the docs say
      `127.0.0.1:6767`; no password by default. Separate fix, outside the dashboard effort
      (dashboard brief D35, [daemon-monitoring-dashboard.md](../../pi-studio-dashboard/swe/grills/daemon-monitoring-dashboard.md)).
      **Decided 2026-11-13: loopback default, `daemon.listen` honoured, warn on an unprotected
      non-loopback bind (no refusal, because Docker binds `0.0.0.0`), dev daemon included.** Planned
      as sprint-087. **Shipped in sprint-087** (daemon now binds `127.0.0.1:6767` by default).
- [x] Tool-permission channel is dormant in production: `PermissionService.requestPermission` and
      `cancelPending` have no non-test caller, the Pi adapter's `getPendingPermissions()` returns
      `[]`, `interrupt_agent` does not call `cancelPending`, and the web client has no permission UI.
      Pi's questions travel on `agent_ui_*` instead ([features/extension-ui-rpc.md](features/extension-ui-rpc.md));
      the dashboard answers those (brief D36). **Decided 2026-11-13: retire the family** (daemon
      service, contract members, MCP tools, CLI `permit`; wire schemas kept unread). **Resolved: retired in sprint-086.**
- [x] Workbench packaging: katex stylesheet inlining in library mode, consumer dev-server
      pre-bundling, the form of the packed-tarball smoke consumer — **resolved in sprint-091**
      (`swe/notes/workbench-packaging-spike.md`). The public region names `PaneArea` and
      `WorkspaceShell` were kept (proposed as-is; the engineer said "proceed" on 2026-11-14 without asking for changes); see
      [architecture/workbench-package.md § TODO(verify)](architecture/workbench-package.md).
- [x] Workbench host: `window.confirm`/`alert`/`prompt` and `target="_blank"` in a Tauri webview —
      **resolved on Linux (sprint-104)** by the desktop host (native confirm/alert, in-app rename,
      `links.openExternal`); not run on macOS or Windows (`desktop/docs/platform-checks.md`).
      Drag-and-drop upload sources and StrictMode-safe host installation were resolved in
      sprint-093 — see
      [architecture/workbench-host-adapter.md § TODO(verify)](architecture/workbench-host-adapter.md).
- [ ] Desktop native host, still open after the Linux run (2026-11-20): a file dragged from the OS
      and the Upload button's picker (neither verified in the headless container), the save
      dialog's start folder, the close-time layout flush (a change in the last ~250 ms before
      closing is lost; fix proposed, not done), the preview kind on macOS and Windows (`inert`
      until measured), and everything else on macOS and Windows — the list is
      `desktop/docs/platform-checks.md`; sprint-106/task-002 waits for a person with those
      machines. Answered on Linux: the preview spike (`origin`), the clipboard, native dialogs
      from an asynchronous call, HTML5 drops, `pagehide` on reload, 1 GiB save (6.5 s, memory
      flat) — see [features/desktop-native-host.md § TODO(verify)](features/desktop-native-host.md).
- [ ] Desktop daemon registry, still open after the Linux run (2026-11-20): a real Node version
      manager (nvm, fnm, volta, Homebrew) and a launch from the macOS Dock, `wrong_key` reaching
      the client (a rotated key looked like `daemon_offline`), a slow first `daemon start` against
      the 90 s limit, daemons with another `PI_STUDIO_HOME`, WSL2, `minDaemonVersion` at first
      release, mode 0600 on macOS and Windows behaviour — sprint-111/task-002 (blocked). Answered
      on Linux: the shell environment under bash, zsh and fish, start-up files that print or take
      8 s, the first start (1.2–2.1 s) — see
      [features/desktop-daemon-registry.md § TODO(verify)](features/desktop-daemon-registry.md).
- [ ] Desktop transport bridge (planned as sprints 112–117, nothing built): the benchmark's thresholds
      and frame sizes, which IPC path each webview uses, the keychain and TLS crates and their
      licences, the keychain on an unsigned macOS build, how the engine reaches the secret store
      off the owner thread, the largest frame either side sends — see
      [features/desktop-transport-bridge.md § TODO(verify)](features/desktop-transport-bridge.md).
- [ ] Desktop transfer engine (planned as sprints 118–123, nothing built): the chosen timing
      values, what stopping a session's socket does to its other requests and over a relay, the
      upload's temporary file in the explorer and after a daemon crash, a command left unanswered
      across a sleep, the native open dialog on macOS and Windows, the release number for
      `minDaemonVersion` — see
      [features/desktop-transfer-engine.md § TODO(verify)](features/desktop-transfer-engine.md).
- [x] Desktop protocol follow-ups: dev-daemon coverage, buffered amount on the relay path, partial
      file after a failed upload, binary fixtures vs the dashboard — **resolved in sprint-096**. The
      water marks (1 MiB / 256 KiB / 10 ms) were chosen, not measured; relay downloads were unpaced
      until relay protocol 2, which paces them via the data socket's real `bufferedAmount` — see
      [features/desktop-client-protocol-followups.md § TODO(verify)](features/desktop-client-protocol-followups.md).
- [x] Desktop protocol follow-ups II: a second binary `Begin` fixture under one opcode passes the
      round-trip test; out-of-tree readers of `transferToken` were not checked; the agent-stream mode
      was live-checked with the mock provider only (no real Pi turn, no live relay) — see
      [features/desktop-client-protocol-followups-2.md § TODO(verify)](features/desktop-client-protocol-followups-2.md).
- [ ] Relay multi-client, still open: the 100 MiB frame-size limit is confirmed but rests on no
      measurement; S9 (outdated daemon vs stale browser tab by silence) still awaits the owner's
      confirmation (it was built as specified and checked live with the 0.0.120 SDK, not a 0.0.120
      browser tab); relay throughput was measured on loopback only; `fern check` was not run. An
      old daemon answering the relay's pings was run (8+ minutes, no redial) — see
      [features/relay-multi-client.md § TODO(verify)](features/relay-multi-client.md) and
      [architecture/relay-protocol.md § TODO(verify)](architecture/relay-protocol.md).
