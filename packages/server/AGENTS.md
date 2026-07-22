# `@av-pi-studio/server` — AGENTS.md

The Pi-Studio **daemon**. Manages agent processes, PTY terminals, git worktrees, projects,
chat rooms, schedules, loops, file transfer, and a service proxy.
Exposes a WebSocket JSON+binary API and an HTTP health/download endpoint.

---

## Binary entrypoints

| Bin | File | Purpose |
|-----|------|---------|
| `pi-studio-daemon` | `src/daemon/main.ts` | Production daemon (real Pi provider, disk persistence, full RPC surface via `bootstrap.ts`) |
| _(dev script)_ | `src/daemon/dev-main.ts` | Dev daemon (in-memory persistence, mock provider only, minimal handler set via `dev-bootstrap.ts`) |

---

## Source layout

```
src/
  index.ts                        Public barrel (re-exports for desktop embedding).
  daemon/
    main.ts                       Production entry: parse env/config, wire bootstrap.ts, listen.
    dev-main.ts                   Dev entry: wires dev-bootstrap.ts (in-memory, mock-only).
    bootstrap.ts                  PRODUCTION handler wiring — the full RPC surface (agents,
                                   projects/git/worktrees/GitHub, terminals, files, service proxy,
                                   schedules/chat/loops, rewind, optional outbound relay).
    dev-bootstrap.ts              DEV handler wiring — in-memory agents + mock provider only, no
                                   auth; a small handler subset for local testing.
    orchestration-rpc.ts          registerOrchestrationHandlers — schedules/chat/loops RPC surface
                                   wired onto the real disk-backed services (bootstrap.ts only).
    relay-transport.ts            connectRelay — outbound E2EE relay dial (@av-pi-studio/relay),
                                   opt-in via config.daemon.relay.enabled (bootstrap.ts only).

  agent/                          Agent lifecycle, provider registry, session operations.
    agent-manager.ts              AgentManager — in-memory state + persistence + broadcast.
    agent-service.ts              AgentService — RPC handler wiring for agent operations.
    provider-contract.ts          AgentClient / AgentSession interfaces (provider-neutral).
    provider-registry.ts          ProviderRegistry — register/lookup AgentClient by provider id.
    provider-snapshot.ts          ProviderSnapshot — cached models/modes/features per provider.
    session-operations.ts         Helpers: create, send, interrupt, update, resume, archive.
    timeline-store.ts             TimelineStore — append/page/cursor the agent event log.
    timeline-rpc.ts               fetch_agent_timeline handler.
    rewind-rpc.ts                 registerRewindHandler — agent.rewind.request (conversation/file
                                   time-travel; bootstrap.ts only).
    permissions.ts                PendingPermissions — park and resolve tool-call auth requests.
    manifest.ts                   ProviderManifest registry.
    structured-generation.ts      Structured output / JSON schema injection.
    mcp-server.ts                 MCP server bridge.
    index.ts
    providers/
      pi/
        agent.ts                  PiAgentClient — spawns pi --mode rpc, manages session.
        event-mapper.ts           Maps raw Pi JSONL events → AgentStreamEvent.
        rpc-transport.ts          Spawn + JSONL RPC transport (stdin/stdout).
        transport-errors.test.ts
        pi-adapter.test.ts
      mock/
        mock-provider.ts          MockAgentClient — in-process stub, no credentials needed.
        mock-provider.test.ts

  ws/
    ws-server.ts                  WebSocketServer — upgrade, handshake (hello/status), sessions.
    session.ts                    Session — per-connection state, send(), capability checks.
    router.ts                     HandlerRegistry + frame router (dispatch session messages).
    capability-store.ts           CapabilityStore — persist client capability flags by clientId.
    index.ts

  http/
    http-server.ts                HTTP server: /api/health, /api/download/:token, static serving.
    host-allowlist.ts             Host header validation (prevents DNS rebinding).
    index.ts

  auth/
    password-auth.ts              PasswordAuth — bcrypt check + WS subprotocol bearer token.
    index.ts

  config/
    daemon-config.ts              DaemonConfig — env + config.json merge, listen/home/password/…
    project-config.ts             Per-project config (.pi-studio/config.json).
    index.ts

  persistence/
    entity-schemas.ts             Zod schemas for all persisted entities (passthrough, optional).
    entity-stores.ts              load*/save* functions — JSON file I/O per entity type.
    atomic-store.ts               AtomicStore — write-to-tmp-then-rename for crash safety.
    index.ts

  terminal/
    terminal-manager.ts           TerminalManager — PTY lifecycle, slot assignment, binary broadcast.
    pty-backend.ts                PtyBackend — node-pty abstraction (injectable for tests).
    screen-buffer.ts              ScreenBuffer — xterm/headless snapshot for new subscribers.
    terminal-rpc.ts               RPC handlers: create/list/resize/input/subscribe/close terminal.
    index.ts

  projects/
    workspace-registry.ts         WorkspaceRegistry + ProjectRegistry — open/list/archive.
    open-project.ts               open_project RPC — resolve git remote, create workspace record.
    git-operations.ts             Git shell helpers (status, branch, commit, diff, …).
    git-detect.ts                 Detect git root + remote from a cwd.
    worktree-service.ts           Git worktree create/list/delete.
    workspace-git-service.ts      WorkspaceGitService — git RPCs for a workspace.
    workspace-activity.ts         Workspace activity tracking (last-used timestamps).
    git-checkout-rpc.ts           Git checkout RPC handlers.
    github-service.ts             GitHub API integration (PRs, issues).
    checkout-diff-manager.ts      Manages diff snapshots for checkout review.
    status-projection.ts          Derives workspace status from agent + git state.
    reconciliation.ts             Project/workspace reconciliation on startup.
    index.ts

  orchestration/
    chat-service.ts               ChatService — rooms, messages, @mentions, cursor-based reads.
    loop-service.ts               LoopService — iterative worker+verifier agent loops.
    schedule-service.ts           ScheduleService — cron/interval schedules firing agent prompts.
    cron.ts                       Cron/interval next-fire-time computation.
    index.ts

  files/
    file-explorer.ts              Directory listing + text/binary file preview.
    file-transfer.ts              Download token issuance + chunked binary transfer.
    download-token-store.ts       Short-lived download token registry (in-memory, LRU).
    index.ts

  proxy/
    service-proxy.ts              ServiceProxy — HTTP reverse proxy to localhost agent services.
    service-port-registry.ts      ServicePortRegistry — register/lookup agent service ports.
    service-hostname.ts           Hostname derivation for service routes.
    index.ts

  logging/
    logger.ts                     Pino logger factory (stdout pretty + rotating NDJSON file).
    index.ts

  util/
    concurrency.ts                p-limit wrappers, mutex helpers.
    index.ts
```

---

## Subsystem reference

### WebSocket server (`ws/`)

`createWebSocketServer(httpServer, deps)` — wraps `ws.WebSocketServer`:

1. Validates `Host` header via `hostCheck` (DNS-rebinding protection).
2. Checks password via `PasswordAuth` (bcrypt or WS subprotocol bearer token).
3. Expects first frame to be `hello`; a non-`hello` first frame closes the socket.
4. Emits `status`/`server_info` after accepting the hello.
5. Calls `deps.onSession(session)` once handshake completes.
6. Routes subsequent frames to `deps.onMessage(session, frame)`.

`HandlerRegistry` (`router.ts`):
- `register(type, handler)` — register a handler for a canonical dotted message type.
- `registerAlias(alias, canonical)` — map legacy flat names to canonical names.
- A handler that throws yields a correlated `rpc_error` back to the sender.
- Unknown types with a `requestId` get an `rpc_error`; without one they are silently ignored.

`Session` (`session.ts`):
- Wraps one WebSocket connection.
- `session.send(msg)` — sends a JSON-serialised message.
- `session.supports(flag)` — checks a `CLIENT_CAPS` flag stored by `CapabilityStore`.
- `session.clientId`, `session.clientType`, `session.capabilities`.

### Agent subsystem (`agent/`)

**`AgentManager`** — the single source of truth for agent state:
- In-memory `Map<agentId, ManagedAgent>` backed by JSON files.
- Enforces the lifecycle FSM: `initializing → idle ↔ running → error → closed`.
- Every transition persists the record AND broadcasts `agent_update` to subscribers.
- Archives (`agent_archived`) soft-delete by setting `archivedAt`.
- On startup, recovers `running` agents (crash recovery).
- Parent/child relationships via `PARENT_AGENT_ID_LABEL = "pi-studio.parent-agent-id"`.

**`ProviderRegistry`** — resolves a provider id string to an `AgentClient`.
Two built-in providers: `pi` and `mock`.

**`AgentClient` / `AgentSession`** (interfaces in `provider-contract.ts`):
- `AgentClient.createSession(config, ctx)` → `AgentSession`
- `AgentSession.run(prompt, opts)` — start a turn; events emitted via `onEvent(handler)`.
- `AgentSession.startTurn(prompt, opts)` — fire-and-forget turn start, returns `{ turnId }`.
- `AgentSession.interrupt()` — cancel the current turn.
- `AgentSession.close()` — shut down the session.
- `AgentSession.update(patch)` — change model/mode/features without recreating.
- `AgentSession.importSession(args)` / `AgentClient.listImportableeSessions()` — resume a
  provider-native session by its handle.
- **`RunOptions.images`** (`RunOptions`/`StartTurnOptions`) carries `ImageAttachment[]` (the
  protocol wire shape `{ mimeType?, data? }`, base64 data). The provider is responsible for
  translating this into its native prompt-image format at the boundary (see Pi provider below).

**Pi provider** (`providers/pi/`):
- Spawns `pi --mode rpc` (or a configured `command`) via `node-pty`/`child_process`.
- `rpc-transport.ts` captures the spawned process's stderr (last 16 KiB) and folds it into both
  the daemon log (`pi process exited non-zero` / `… with commands in flight`) and the `error`
  stream event's `message` on a crash — a non-zero/signal exit with no stderr output surfaces as
  a bare exit-code message instead.
- Communicates over stdin/stdout as JSONL (`PiRpcTransport`).
- `event-mapper.ts` maps raw Pi events (`assistant_message`, `tool_call`, `turn_completed`, …)
  to `AgentStreamEvent`s.
- Discovers models/modes via top-level `get_modes`/`get_models` RPCs (no scratch session).
- A `~` in `cwd` is expanded to `os.homedir()` before spawning.
- **`daemon.piHome`** (`config.json`, or `PI_STUDIO_PI_HOME` env): redirects the bundled Pi CLI's
  own `.pi` config dir. `provider-registry.ts#buildPiClient` derives
  `PI_CODING_AGENT_DIR=<piHome>/agent` and `PI_CODING_AGENT_SESSION_DIR=<piHome>/agent/sessions`
  as the base env for every spawned `pi` process; an explicit `agents.providers.pi.env` entry
  overrides these (merged last in `PiAgentClient.buildEnv`).
- **Prompt images:** `startTurn` translates `RunOptions.images` (wire shape `{ mimeType, data }`)
  into Pi's `ImageContent` shape `{ type: "image", data, mimeType }` before the `prompt` RPC
  notify (`docs/rpc.md` — `{ type: "prompt", message, images? }`). The wire shape is NOT forwarded
  verbatim; conversion happens at this boundary so the wire protocol stays provider-neutral.

**Mock provider** (`providers/mock/`):
- In-process, emits synthetic events on a small timer loop.
- No credentials; used for smoke tests and POC.

**`TimelineStore`**:
- Append-only event log, capped per agent.
- Cursor-based paging via `fetchAgentTimeline(agentId, cursor, direction, limit)`.
- Collapsed/merged view for UI display.

**`PendingPermissions`** (`permissions.ts`):
- Parks tool-call permission requests with a `requestId`.
- `park(request)` — store and broadcast `agent_permission_request`.
- `resolve(permissionRequestId, decision)` — fulfill the parked request.

### Terminal subsystem (`terminal/`)

**`TerminalManager`**:
- Creates PTY processes via `PtyBackend` (`node-pty` by default).
- Assigns a `slot` (0–255) to each terminal for binary frame multiplexing.
- **Output coalescing**: batches PTY output into 4 ms windows before broadcasting.
- **Screen snapshot**: `ScreenBuffer` (xterm/headless) retains the last ≤64 KiB of output as a
  snapshot for new subscribers (so they see the current screen state).
- **Size ownership**: last-interacting-client-wins. The manager only resizes when a client
  explicitly sends a `Resize` frame; it never resizes on subscribe.
- `subscribe(slot, sink)` — attach a raw-binary-frame sink; replays the snapshot first.

Terminal RPC handlers (`terminal-rpc.ts`):
- `create_terminal` — spawn PTY, return slot + entry.
- `list_terminals` — list all live terminals.
- `resize_terminal` — resize PTY.
- `close_terminal` — kill PTY.
- Binary `Input` frames → write to PTY stdin.

### Projects / Git subsystem (`projects/`)

- **`WorkspaceRegistry`** / **`ProjectRegistry`**: JSON array files with `archivedAt` soft-delete.
- **Project key derivation**: normalizes git remote URLs to `host/owner/repo` form for grouping.
- **`WorkspaceKind`**: `local_checkout | worktree | directory` (legacy `checkout` → `local_checkout`).
- **`WorktreeService`**: `git worktree add/list/remove` via shell.
- **`WorkspaceGitService`**: git status, branch, diff, commit, log per workspace.
- **`GitHubService`**: GitHub API (PRs, issues) via `GITHUB_TOKEN`.
- **Reconciliation**: on startup, reconciles workspace records with filesystem reality.

### Orchestration (`orchestration/`)

**`ChatService`**:
- Rooms: unique names (case-insensitive), `purpose` field, soft-delete.
- Messages: cursor-based reads, `@mention` parsing → `mentionAgentIds`.
- Wait API: `waitForMessages(roomId, sinceCursor, timeoutMs)` — long-poll for new messages.

**`ScheduleService`**:
- Cadences: `cron` (crontab expression), `every` (interval in seconds), `once` (absolute datetime).
- Targets: `new-agent` (create + prompt) or `agent` (heartbeat into an existing agent).
- Records `ScheduleRun` per firing; respects `maxRuns`, `expiresAt`.
- Next-fire computation via `cron.ts` (`assertValidCron`, `nextCronTime`, `nextEveryTime`).

**`LoopService`** ("Ralph loops"):
- Each iteration: run worker agent → run `verifyChecks` shell commands → run optional `verifyPrompt`
  verifier agent.
- Iteration succeeds only if ALL checks AND the prompt pass.
- Loop ends: first success → `succeeded`; `maxIterations`/`maxTimeMs` exceeded → `failed`;
  explicit stop → `stopped`.
- On startup, `running` loops are recovered as `stopped` with an interruption log entry.

### Persistence (`persistence/`)

All stores use `AtomicStore` (write-to-temp-then-rename) for crash safety.

**Entity file locations** (relative to `$PI_STUDIO_HOME`):
- `agents/<sanitized-cwd>/<agentId>.json`
- `chat/rooms.json`
- `loops/<loopId>.json`
- `schedules/<scheduleId>.json`
- `projects.json`
- `workspaces.json`

All schemas use `.passthrough()` and optional fields — never throw on unknown fields from newer
daemon versions.

### HTTP server (`http/`)

- `GET /api/health` → `{ status: "ok" }` (unauthenticated)
- `GET /api/download/:token` → streams a pre-issued file download (token from `DownloadTokenStore`)
- Static serving for `app/` assets (future sprint)
- `HostAllowlist` rejects requests with disallowed `Host` headers (DNS-rebinding protection)

### Auth (`auth/`)

`PasswordAuth`:
- bcrypt-hashes the configured password and checks it against:
  - A `password` query-string param on the WS upgrade URL.
  - A `pi-studio-bearer.<base64(password)>` WS subprotocol header.
- Auth is optional; an unset password allows all connections.

### Logging (`logging/`)

`createDaemonLogger(home, opts)` / `createLogger(opts)` return a `pino` logger (the `Logger`
interface in `logging/logger.ts`) that:
- **Always writes stdout** — pretty/colorized on a TTY, raw NDJSON otherwise (so `docker logs`,
  journald, and PM2 work with zero configuration).
- **Additionally writes rotating NDJSON** to `$PI_STUDIO_HOME/logs/` when a home/logDir is set
  (multistream — both destinations, never either/or).
- Level from `PI_STUDIO_LOG_LEVEL` (`trace`|`debug`|`info`|`warn`|`error`|`fatal`|`silent`),
  default `info`; `opts.level` overrides. `silentLogger()` is the test no-op.

The daemon creates ONE logger in `startDaemon`/`startDevDaemon` (injectable via
`DaemonOptions.logger`/`DevBootstrapOptions.logger`) and threads it through every subsystem:

| Where | What gets logged |
|---|---|
| `bootstrap.ts` / `dev-bootstrap.ts` | daemon starting (home, configPath, serverId), agent recovery count, agent archived/deleted, relay dial lifecycle, bind errors, shutdown |
| `ws/ws-server.ts` | upgrade rejections (host allowlist, auth — `warn`), handshake failures (`warn`), client disconnect with close code + duration (`info`) |
| `ws/router.ts` (`HandlerRegistry(logger)`) | every RPC at `debug` (type, requestId, clientId, durationMs), handler failures at `warn`, unknown types at `debug` — one instrumentation point covering the whole RPC surface |
| `agent/agent-service.ts` | agent created (provider, model, cwd), turn started (prompt SIZE, never contents), turn finished (outcome + durationMs), provider session failures |
| `terminal/terminal-manager.ts` | terminal opened (slot, shell, cwd, size), kill requested, exited, spawn failures |
| `agent/providers/pi/rpc-transport.ts` | `pi` process spawned (pid, cwd), spawn failures, exits (code/signal; `error` when commands were in flight) |

**Logs are metadata-only by convention**: prompt text, message contents, and terminal output are
user data — never log them (sizes/counts only). Connection metadata, ids, durations, and error
messages are fair game.

---

## Key invariants

- **`provider-contract.ts` is the only surface** the rest of the daemon sees. Never import
  `providers/pi/` or `providers/mock/` from outside `agent/`.
- **`HandlerRegistry` is explicit.** Register handlers in bootstrap/dev-bootstrap, not
  auto-discovery.
- **AgentManager transitions are the only way to change agent status.** Call
  `manager.transition(agentId, newStatus)`, never mutate the record directly.
- **All entity schemas use `.passthrough()`.** Unknown fields from newer daemons must load silently.
- **New subsystems take the injected `Logger`, never `console.*`.** The daemon's one logger is
  created in bootstrap and threaded everywhere; a bare `console.log` bypasses level control,
  structure, and the rotating file. Log metadata only — never prompt text, message contents, or
  terminal output.
- **Terminal snapshot is optional for correctness.** A subscriber that arrives after PTY exit gets
  the last snapshot; no new Output frames will arrive.
- **Service proxy auth bypass is intentional.** The service proxy route is not gated by daemon
  password auth (per spec). Do not add auth there.
- **`bootstrap.ts` must never import `dev-bootstrap.ts`** (the reverse is fine, and happens today —
  `dev-bootstrap.ts` imports the shared `wrapSessionEnvelope` helper from `bootstrap.ts`, nothing
  more). `bootstrap.ts` owns the full disk-backed feature surface (real provider, orchestration,
  git, relay) and is production-only; `dev-bootstrap.ts` stays intentionally minimal (in-memory,
  mock provider) for fast local iteration and must not grow that same surface.
- **Relay connections need their own persistent `Session`, not a synthetic one built per message,
  AND that `Session` must be dropped whenever a NEW peer completes the E2EE handshake — not only
  on a relay-socket-level reconnect.** Every relay frame must reuse the same `Session` for the life
  of one relay connection so the `hello`→`status`/`server_info` handshake (which `routeTextFrame`
  does not itself understand) can complete and capabilities persist across frames — see
  `relay-transport.ts`'s dispatch in `bootstrap.ts` and its regression test in `bootstrap.test.ts`
  (a real cross-VM smoke test caught this as a genuine bug: a bare relay dispatch that piped every
  message into `routeTextFrame` directly hung every relay client indefinitely past the E2EE
  handshake). Separately: the relay places no cap on how many client sockets attach to the
  daemon's one long-lived session id over its process lifetime (browser reload, second tab, plain
  reconnect), and `createDaemonChannel` now re-arms its handshake for each new one
  (`@av-pi-studio/relay`) rather than latching onto the first client forever. `connectRelay`'s
  `onHandshake` event fires on every one of those re-handshakes, and `bootstrap.ts` wires it to
  `resetRelaySession()` — otherwise a second peer's app traffic would get silently attributed to
  the FIRST peer's now-defunct `Session` (wrong `clientId`/capabilities) instead of starting its
  own `hello` handshake. This was a real bug caught via a live docker-compose smoke test, not
  theoretical: a second browser connecting to an already-paired daemon hung forever on
  "cannot send before the E2EE handshake completes" because the daemon channel silently dropped
  its `e2ee_hello`.
- **The relay's synthetic `Session.sendBinary()` and `Session.send()` share one socket-shaped
  object whose `send(data)` discriminates by argument type** (`string` → `relayReply`/`e2ee_app`,
  `Uint8Array` → `relayReplyBinary`/`e2ee_bin`) — see `bootstrap.ts`'s relay wiring. Both
  `relayReply` and `relayReplyBinary` are captured from `connectRelay`'s `onMessage`/
  `onBinaryMessage` callbacks respectively and must be reset (`= null`) alongside
  `resetRelaySession()` on `onReconnect`, or a stale reply closure from a dead relay socket could
  be invoked. Terminal I/O and file-transfer chunks ride this binary path — they are real binary
  application data, but they cross the relay wire as base64-wrapped JSON text frames
  (`@av-pi-studio/relay`'s `e2ee_bin`), never raw binary WebSocket frames; see that package's
  AGENTS.md § Wire format for why.

---

## Testing

```bash
npx vitest run packages/server
```

Each subsystem has co-located `*.test.ts` files. Provider tests inject stub transports;
persistence tests use temporary directories; WS tests use in-memory session stubs.
