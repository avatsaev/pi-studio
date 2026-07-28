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
    inline-image-instructions.ts  INLINE_IMAGE_INSTRUCTIONS — the short agent-facing instruction
                                   `handleCreate` appends to `config.systemPrompt` when the
                                   creating connection advertised `inline_image_markdown`
                                   (task-006, sprint-045); bound at spawn time only (see its own
                                   header comment for the accepted limitation).
    provider-contract.ts          AgentClient / AgentSession interfaces (provider-neutral).
    provider-registry.ts          ProviderRegistry — register/lookup AgentClient by provider id.
    provider-snapshot.ts          ProviderSnapshot — cached models/modes/features per provider.
    session-operations.ts         Helpers: interrupt, steer/follow-up, update, resume, import.
    slash-command-operations.ts   SlashCommandOperationsService — RPCs for Pi built-in slash
                                   commands with a real Pi RPC equivalent (/session, /compact,
                                   /new, /resume, /fork, /clone, /name, /export, /model, /copy),
                                   plus command discovery (agent_list_commands_request, sprint-040).
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
        session-hydration.ts      hydrateTimelineFromSessionFile — rebuild a timeline by reading
                                   Pi's own on-disk JSONL session file (no live process needed).
        session-hydration.test.ts
        transport-errors.test.ts
        pi-adapter.test.ts
      mock/
        mock-provider.ts          MockAgentClient — in-process stub, no credentials needed.
        mock-provider.test.ts

  ws/
    ws-server.ts                  WebSocketServer — upgrade, handshake (hello/status), sessions.
    session.ts                    Session — per-connection state, send(), capability checks.
    router.ts                     HandlerRegistry + frame router (dispatch session messages).
    session-subscriptions.ts      SessionSubscriptions — per-session subscription registry,
                                   disposes all subscriptions on socket close.
    capability-store.ts           CapabilityStore — persist client capability flags by clientId.
    index.ts

  http/
    http-server.ts                HTTP server: /api/health, Host-allowlist, CORS, optional bearer auth, and an `onRequest` delegate (wired to the service proxy).
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
    file-watch-service.ts         FileWatchService — ref-counted fs.watch filesystem watcher,
                                   watches files or directories, debounced per-subscription.
    file-watch-rpc.ts             registerFileWatchHandlers — file_watch_subscribe/_unsubscribe
                                   RPCs, file_changed push.
    limits.ts                     MAX_INLINE_FILE_READ_BYTES (5 MiB) — file_read_request ceiling.
    download-token-store.ts       Short-lived download token registry (in-memory, LRU).
    resolve-path.ts               expandHome — the package's single `~`/`~/` expansion helper
                                   (task-001, sprint-045); every file-path RPC + `file-watch-
                                   service.ts`/`agent/providers/pi/rpc-transport.ts` (re-export)
                                   route through this instead of a per-call-site inline check.
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
- Enforces the lifecycle FSM: `initializing → idle ↔ running → error → closed` via `setStatus()`.
- `updateRecord(id, patch)` merges arbitrary persisted fields (title, labels, config, …) and
  writes them to disk; it does NOT broadcast — each RPC call site (`update_agent`,
  `agent_set_session_name_request`, …) owns its own `agent_update` broadcast shape/timing. This is
  the only path that may write to a record's fields; nothing outside `AgentManager` may mutate
  `managed.record` directly (a patch that only touches the in-memory object without going through
  `updateRecord`/`setStatus` never reaches `agents/**.json` — this was a real bug in session
  rename, fixed by routing both rename RPCs through `updateRecord`).
- Every status transition and every `updateRecord` call persists the record to disk.
- Archives (`agent_archived`) soft-delete by setting `archivedAt`.
- On startup, `recover()` rehydrates every persisted record with no live session attached, and
  normalizes any record still stuck at `running`/`initializing` (daemon killed mid-turn) back to
  `idle` — both in memory and on disk — since neither status is a legal resting state without a
  session. Without this, a crash mid-turn permanently wedges that session in the web UI: the
  "working" indicator never clears, and `interrupt_agent` (Stop) is a no-op because there is no
  session to interrupt. `interrupt_agent` applies the same normalization as a second line of
  defense whenever it finds a session-less record still claiming `running`/`initializing`.
- Parent/child relationships via `PARENT_AGENT_ID_LABEL = "pi-studio.parent-agent-id"`.
- **Deferred draft creation** — `create_agent_request` (`agent-service.ts` `handleCreate`) with no
  `initialPrompt` persists the `AgentRecord` (including the raw client `config`, so it survives to
  a later first spawn) but does **not** spawn a provider process: `managed.session` stays `null`
  and `record.persistence` stays unset. Backs the web-client's "New chat" tab materializing into a
  real, restorable draft — surviving reload/reconnect — without paying for a `pi` process or a
  Pi-owned JSONL session file until the user actually sends. Every other caller of this RPC (CLI
  `run`, the MCP `create_agent` tool, `ScheduleService`, `LoopService`) always passes
  `initialPrompt`, so eager creation is unaffected. `spawnOrResumeSession` (`agent-service.ts`,
  shared by `AgentService.handleSendPrompt` and `SessionOperationsService.handleResume`) is the
  single place that turns a record into a live session: `resumeSession` from `record.persistence`
  when present, else a first-ever `createSession` — and, only on that first spawn, replays
  `record.config.model`/`config.modelProvider` via `setProviderModel` (unconditionally: whatever
  was pinned when the draft materialized, whether the untouched preselected default or an
  explicit pick — see `resolve_default_model` below), since neither `createSession` nor
  `resumeSession` themselves consult `AgentSessionConfig.model` (Pi resolves its own default at
  spawn regardless).
- `list_agents_request` (both `bootstrap.ts` and `dev-bootstrap.ts`) returns each active agent's
  `agentId`/`status`/`title`/`cwd`/`labels`/`lastActivity`, plus **`provider`** (always
  `record.provider`), **`model`** (sprint-042: `managed.session?.getRuntimeInfo().model ??
  managed.record.config?.model` — the live attached session's runtime info first (Pi's own
  `get_state` is the ultimate source of truth there, `providers/pi/agent.ts`), falling back to
  `record.config.model` for an agent with no currently-attached session, e.g. a deferred draft, or
  right after a daemon restart before it's resumed — restore is lazy (`daemon-bootstrap.md` §
  Recovery) and never spawns a process just to ask Pi its model), and **`modelProvider`** (always
  `record.config?.modelProvider` — no live-session override exists for this one: a session's
  `getRuntimeInfo().provider` is the pi-studio `AgentClient` id, a different namespace, never the
  model's own LLM provider). `SlashCommandOperationsService.persistModel` (`slash-command-
  operations.ts`) writes every `/model` set/cycle's `model` **and** `modelProvider` into
  `record.config` via `AgentManager.updateRecord` so both fallbacks have real values instead of
  `undefined` (previously the reported bug: a restored session's model selector came back empty
  even though `/model` had been set earlier in the same conversation — and separately,
  `modelProvider` was dropped entirely, which silently no-op'd the NEXT pick after any restore,
  since the client's live-set path bails out early when it doesn't have one).
  **`handleSetModel` (`/model` set) branches on whether the agent has a live session at all**,
  not just whether `agentId` is bound: a deferred draft's `agentId` is bound the instant it
  materializes (`ensureMaterialized`), long before any process spawns, so `managed.session` stays
  `null` until the first send. Routing that case through `requireSession` (which throws `"has no
  live session"`) was a real shipped bug — the client swallows the RPC rejection with no dedicated
  UI surface, so picking a model on an already-materialized-but-unspawned draft looked like it
  worked (the client's own optimistic store update) but never reached `persistModel`, silently
  reverting to the default on the next reconnect. `handleSetModel` now short-circuits that case:
  no live session → persist `modelId`/`provider` straight into `record.config` (the exact same
  write `spawnOrResumeSession`'s first-spawn replay reads back later) and return success, without
  attempting `session.setProviderModel` at all. For an *already-live* session this value is a
  display cache only — it is never sent back to Pi on resume (`resumeSession` only passes `cwd`),
  so it can never override Pi's own remembered model once the session is actually live again; the
  one case where it IS sent back is a deferred draft's first spawn (`spawnOrResumeSession` above),
  which is a `createSession`, not a resume. No protocol schema exists for
  `list_agents_request`/`response` at all — it is, and remains, an untyped ad hoc RPC on both
  server and client.
- **Inline-image capability composes the system prompt at create time** (`handleCreate`,
  task-006 sprint-045): `registerHandlers` passes the RPC's own `ctx.session` into `handleCreate`
  as `wsSession` (named to avoid colliding with the function's existing `session: AgentSession`
  local for the spawned provider session). When `wsSession?.supports(CLIENT_CAPS.
  inline_image_markdown)`, `handleCreate` builds an `effectiveConfig` — a NEW object, never a
  mutation of the incoming `msg.config` — whose `systemPrompt` is `[callerPrompt,
  INLINE_IMAGE_INSTRUCTIONS].filter(Boolean).join("\n\n")`: a caller-supplied prompt is always
  preserved verbatim and always comes first, the instruction is always appended after, separated
  by a blank line. `effectiveConfig` (not the raw `config`) is what both the persisted
  `AgentRecord.config` AND the eager-spawn path's `client.createSession(...)` call use, so a
  same-turn immediate spawn and a later `spawnOrResumeSession` replay both see the composed
  value. No `wsSession` (every CLI/MCP/scheduled-agent caller — none of them has a `Session` at
  hand) → `effectiveConfig === config`, untouched. Task-005 (below) is what makes the composed
  value survive a daemon restart: `resumeSession` reads it back via `overrides.systemPrompt`.

**`ProviderRegistry`** — resolves a provider id string to an `AgentClient`.
Two built-in providers: `pi` and `mock`.

**`list_provider_models`** (sprint-043, both `bootstrap.ts` and `dev-bootstrap.ts`) — resolves the
requested `provider` (default `"pi"`) via `resolveClient` and returns
`{ type: "list_provider_models_response", requestId, provider, models: AgentModelDefinition[] }`
by calling `AgentClient.listModels(opts?: { cwd?: string })` directly — no agent session is spawned.
Backs the web-client composer's model-selector popup (`packages/web-client/src/features/chat/
ModelMenu.tsx`). Like `list_providers`/`list_agents_request`, it is registered as a flat ad hoc RPC
with no protocol schema and is not in `sessionMessageSchema`'s discriminated union — it validates
via the `sessionMessageBaseSchema` passthrough fallback. Each returned `AgentModelDefinition`
(`provider-contract.ts`) carries `provider` — the model's OWN underlying LLM provider (e.g.
`"anthropic"`), read
straight from Pi's `Model` object's own `provider` field, NOT the `"pi"` `AgentClient` id used to
resolve which client answered this RPC. Dropping this field when mapping Pi's raw model list was a
real shipped bug: every `agent_set_model_request` calling `setProviderModel("pi", modelId)` failed
with `"Model not found: pi/<modelId>"` since Pi has no model registered under a provider literally
named "pi" — the client must pass each model's own `provider`, never this RPC's `provider` param.

**`resolve_default_model`** (both `bootstrap.ts` and `dev-bootstrap.ts`) — resolves the model a
brand-new session with no override would run on: settings' configured default, else the
provider's built-in default (docs/settings.md `defaultModel`/`defaultProvider`). Calls
`AgentClient.resolveDefaultModel(opts?: { cwd?: string })` (optional capability; `providers/pi/
agent.ts` implements it by spawning a *transient* `pi --mode rpc --no-session` process purely to
ask `get_state`, then closing it — `--no-session` guarantees no scratch JSONL file is left behind,
the exact risk flagged for spawning a session-anchored process just to read metadata) and returns
`{ type: "resolve_default_model_response", requestId, provider, model?, modelProvider? }`. Results
are cached per `(provider, cwd)` for the daemon process's lifetime — the default rarely changes, so
this fires once, not on every "New chat". Backs the web-client's "preselect the default model on a
new chat" (`stores/materialize.ts` `resolveDefaultModel`): purely a display seed, never itself
persisted until a draft materializes (`ensureMaterialized`), at which point it's pinned into
`config.model`/`config.modelProvider` exactly like an explicit pick — see "Deferred draft
creation" above.

**`AgentClient` / `AgentSession`** (interfaces in `provider-contract.ts`):
- `AgentClient.createSession(config, ctx)` → `AgentSession`
- `AgentSession.run(prompt, opts)` — start a turn; events emitted via `onEvent(handler)`.
- `AgentSession.startTurn(prompt, opts)` — fire-and-forget turn start, returns `{ turnId }`.
- `AgentSession.interrupt()` — cancel the current turn.
- `AgentSession.steer(message, opts?)` / `AgentSession.followUp(message, opts?)` (both optional,
  present when `capabilities.supportsSteering`) — **inject a message into a LIVE turn** without
  starting a new turn (Pi RPC `steer`/`follow_up`, docs/rpc.md). `steer` is delivered after the
  current assistant turn's tool calls, before the next LLM call; `follow_up` only after the agent
  fully stops. Fire-and-forget like `interrupt`; the provider confirms queue state asynchronously
  via a `queue_update` stream event (mapped in `event-mapper.ts`), NOT via a response. Wired as the
  daemon RPCs `steer_agent_request` / `follow_up_agent_request` in `session-operations.ts`
  (`handleSteer`) — these reach the live session directly, never route through `runTurn`, and never
  change agent status. The handler optimistically appends the injected text as a `user_message`
  timeline row so history shows it; `ok:false` when there is no live session.
- `AgentSession.close()` — shut down the session.
- `AgentSession.update(patch)` — change model/mode/features without recreating.
- `AgentSession.importSession(args)` / `AgentClient.listImportableeSessions()` — resume a
  provider-native session by its handle.
- **`RunOptions.images`** (`RunOptions`/`StartTurnOptions`) carries `ImageAttachment[]` (the
  protocol wire shape `{ mimeType?, data? }`, base64 data). The provider is responsible for
  translating this into its native prompt-image format at the boundary (see Pi provider below).
- **Slash-command operations** (`AgentSession`, all optional, sprint-037): `getSessionStats`,
  `compact`, `newSession`, `switchSession`, `fork`/`getForkMessages`, `clone`, `setSessionName`,
  `exportHtml`, `setProviderModel`, `cycleModel`, `getLastAssistantText` — mirror Pi built-in slash
  commands that have a real Pi RPC equivalent (`/session`, `/compact`, `/new`, `/resume`, `/fork`,
  `/clone`, `/name`, `/export`, `/model`, `/copy`). Wired as their own daemon RPCs by
  `slash-command-operations.ts` (`agent_session_stats_request`, `agent_compact_request`, …), NOT
  routed through `prompt` — Pi's own RPC contract states built-in TUI commands without one of
  these RPC equivalents (`/settings`, `/hotkeys`, …) are never expanded by `prompt` and have no
  wire representation here. Unimplemented on a provider (e.g. `mock`) → `rpc_error`, never silent.
  `handleSessionStats` (sprint-042) back-fills `payload.model` from
  `session.getRuntimeInfo().model` whenever the provider's own `getSessionStats()` result omits
  it — making the RPC a self-correcting model source for a poll-driven client (covers `/model`
  cycle and cross-client changes an `agent_update` broadcast alone can't fully convey).
- **Command discovery** (`AgentSession.listCommands?()`, optional, sprint-040): surfaces Pi's
  `get_commands` RPC — extension commands (`pi.registerCommand()`), prompt templates (global
  `~/.pi/agent/prompts/*.md`; project `<cwd>/.pi/prompts/*.md`, gated behind Pi's own project-trust
  decision — see `~/.pi/agent/trust.json` — a bare untrusted `.pi/prompts/` dir is silently
  invisible to `get_commands`, not an error), and skills (`.pi/agent/skills/<name>/SKILL.md`) — a
  set disjoint from the built-in slash commands above (Pi's own structured RPCs are never returned
  by `get_commands`). Wired as `agent_list_commands_request`/`_response` by
  `slash-command-operations.ts`'s `handleListCommands`; unlike every other handler in that file it
  lazily spawns/resumes (`spawnOrResumeSession`, same as `AgentService.handleSendPrompt`) instead
  of requiring an already-live `managed.session` — the web-client's `/` picker must work on a
  never-sent "New chat" draft, which otherwise has no process yet. `AgentCommandDefinition` carries
  `name` (required), optional `id`/`label`/`description`/`source`
  (`extension`\|`prompt`\|`skill`)/`scope` (`user`\|`project`\|`temporary`)/`path`. Implemented for
  `pi` (maps `RpcSlashCommand.sourceInfo`) and `mock` (fixed 3-entry list, one per source, for
  dependency-free testing); unimplemented on a provider → `rpc_error`, never silent. Consumed by the
  SDK (`client.agent(id).listCommands()`), CLI (`pi-studio agent commands <agentId>`), and the
  web-client's `/` composer picker (`packages/web-client/AGENTS.md` § Slash-command picker).
- **A `/`-prefixed prompt must not hang the turn** (`providers/pi/agent.ts`'s `run`/
  `runSlashPrompt`, web-client slash commands): Pi runs an extension command inline and returns
  from `prompt()` immediately — **no turn lifecycle event is ever emitted for it** — but
  `PiAgentSession.run()` otherwise only resolves on `turn_completed`/`turn_failed`/`turn_canceled`,
  so awaiting one for an inline command would hang the turn (and the agent's `"running"` status)
  forever. `run` routes any prompt starting with `/` through `runSlashPrompt`, which sends `prompt`
  as a correlated `request` (not the usual fire-and-forget `notify`) so Pi's own ack is observable,
  then probes `get_state.isStreaming`: `false` means the command ran inline and there is no turn to
  await (return immediately); `true` means a real turn started (a prompt template or a
  `pi.sendMessage` skill/extension call) and the existing terminal-event wait applies as normal. An
  ack rejection now surfaces as a rejected turn instead of being silently dropped the way an
  unmatched `notify` response is.

**Pi provider** (`providers/pi/`):
- Spawns `pi --mode rpc` (or a configured `command`) via `node-pty`/`child_process`.
- `rpc-transport.ts` captures the spawned process's stderr (last 16 KiB) and folds it into both
  the daemon log (`pi process exited non-zero` / `… with commands in flight`) and the `error`
  stream event's `message` on a crash — a non-zero/signal exit with no stderr output surfaces as
  a bare exit-code message instead.
- **`resumeSession(handle, …)` always spawns a fresh `pi --mode rpc` process, then issues
  `switch_session` to load `handle.nativeHandle`'s JSONL history into it.** RPC mode has no CLI
  flag to preload a session at spawn — `--session <path>` is a TUI-only flag (docs/usage.md),
  absent from `docs/rpc.md`'s own "Common options" — so a freshly spawned process always starts
  on its own new/default session with zero history; `switch_session` is the documented RPC
  mechanism for loading one into an already-running process. `importSession` calls
  `resumeSession` internally and shares this same requirement. Skipping this call was a real bug:
  the daemon's own record/timeline still showed the full prior conversation (fetched separately
  from `agents/**.json`), so the UI looked fine right up until the next prompt, which then got no
  prior context at all — after a daemon restart or `/import`, the live `pi` process had amnesia
  even though the chat history on screen looked intact.
- **`createSession`/`resumeSession` must stay in agreement on `systemPrompt` handling** (task-005,
  sprint-045 — a pre-existing defect this fixed): `resumeSession` used to build its spawn args
  with `appendSystemPrompt: this.deps.appendSystemPrompt` unconditionally, ignoring
  `overrides?.systemPrompt` even though `overrides` is exactly `record.config` passed down from
  `spawnOrResumeSession`/`SessionOperationsService.handleResume` — so every daemon restart (and
  the first spawn of a deferred draft that happens to resume rather than create) silently dropped
  the session's own per-session system prompt back to the daemon-wide default. Both methods now
  read `config.systemPrompt ?? this.deps.appendSystemPrompt` /
  `overrides?.systemPrompt ?? this.deps.appendSystemPrompt` — identical fallback shape, each with
  a `NOTE:` comment pointing at the other so a future edit to one is not made in isolation.
  `importSession` shares `resumeSession`'s code path and inherited the fix for free. This is what
  makes the inline-image capability's composed system prompt (`handleCreate`'s `effectiveConfig`
  above) survive a restart-then-resume instead of reverting on the very next process spawn.
- **`getRuntimeInfo().model` is cached, not live** — Pi has no synchronous way to report its
  current model, and the contract method `getRuntimeInfo()` cannot itself make an RPC call.
  `discoverState()` (also renamed from `discoverSessionFile()`, sprint-042) issues ONE `get_state`
  call after both `createSession` and `resumeSession` construct the session, reading Pi's `Model`
  object (`{id, name, api, provider}`, docs/rpc.md § Model) out of `data.model` into a cached
  field — never clobbering an already-known `sessionFile` (resume/import anchor it up front).
  `setProviderModel`/`cycleModel` also update the cache from their own responses, so an explicit
  `/model` set/cycle is reflected immediately, not only on the next `discoverState()`. Before this,
  `getRuntimeInfo().model` was always `undefined` for the real `pi` provider — only the `mock`
  provider ever populated it — silently defeating `list_agents_request`'s `model` field (above)
  and `agent_session_stats_request`'s runtime-info fallback (`slash-command-operations.ts`
  `handleSessionStats`) for the only provider used in production. Caught by a live smoke test
  against a real spawned `pi --mode rpc` process, not by any unit test.
- Communicates over stdin/stdout as JSONL (`PiRpcTransport`).
- `event-mapper.ts` maps raw Pi events (`assistant_message`, `tool_call`, `turn_completed`, …)
  to `AgentStreamEvent`s.
- **`agent_end`'s `messages` array is the only place a live turn's real outcome is decided** — it
  used to unconditionally map to `turn_completed`, ignoring the payload entirely. `session-
  hydration.ts` (restore-from-JSONL) always correctly read the closing assistant message's
  `stopReason`/`errorMessage` to emit `turn_failed`/`turn_canceled`, but the *live* mapper did
  not mirror that check — so a turn that failed immediately (e.g. a provider 429/quota-exceeded
  rejection) was reported live as a plain success: no `turn_failed`/error ever reached the
  client's live stream, `runTurn`'s own `newStatus` computation (which trusts this same mapping)
  never learned the turn failed either, and the error only became visible after a full
  reconnect/restore re-read the (correctly-hydrated) persisted timeline. Fixed by having the
  `agent_end` case find the last assistant-role message in `event.messages` and check its
  `stopReason` exactly like `session-hydration.ts` does, before falling back to
  `turn_completed`. Caught by live-testing the exact repro (fresh chat → pick a model known to
  429 → send) against a real `pi --mode rpc` process, not by any pre-existing unit test.
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


### File watching (`files/`)

**`FileWatchService`** (the daemon's first real filesystem watcher):
- `subscribe(path, listener): () => void` — watch one file **or** one directory.
- **File watch strategy**: if `path` is a file, watches its *parent directory* with a filename
  filter. This survives atomic-rename saves (write temp file, then `rename(tmp, target)` — the
  original inode unlinks, but a directory watcher sees both the unlink and the rename as separate
  events). Direct inode watches don't detect this pattern, so directory-level watching is
  intentional and correct for the molecule viewer's MD trajectory editing workflows and general
  text-editor integration.
- **Per-directory ref-counting**: maintains a `WeakMap<string, DirWatch>` keyed by directory path.
  One `fs.watch` handle per directory, shared by all subscribers (file + directory) targeting that
  directory. Torn down when the last subscriber unsubscribes.
- **Per-subscription debounce** (`FILE_WATCH_COALESCE_MS = 150` ms): collapses a write+rename
  burst (e.g., an editor save + git apply) into one push, chosen above `TerminalManager`'s 4 ms
  window but safely below the client's own 500 ms post-tool debounce.
- **Watcher errors** (e.g., permission denied, watched file deleted): snapshot and notify each
  affected subscription synchronously (bypassing the debounce), then dispose the directory watch.

**File watch RPC family** (`file-watch-rpc.ts`, validated via `sessionMessageBaseSchema`
passthrough fallback, NOT a `messages.ts` discriminated union):
- `file_watch_subscribe { path }` → `{ type, path, ok, [error: "too_many_watches"] }` — open a
  live watch on `path` (file or directory, `~`/`~/` expanded via `resolve-path.ts`'s `expandHome`).
- `file_watch_unsubscribe { path }` → `{ type, path, ok }` — close the watch.
- `file_changed { path }` (push) — daemon → client, sent when a watched `path` changes.

**Per-session cap** (`MAX_FILE_WATCHES_PER_SESSION = 128`):
- Each session has a hard limit of 128 concurrent file watches (per-session, not global). Exists
  because `fs.watch` consumes an inotify handle per directory and the kernel enforces a global
  `fs.inotify.max_user_watches` limit (typically 8192 system-wide); a buggy tree-expansion effect
  (or an attacker) subscribing in a loop would otherwise exhaust it and break file watching
  across the entire machine. A same-path resubscribe replaces in place and never counts against
  the cap (via `SessionSubscriptions.add`'s contract).
- **`too_many_watches` reply**: when a new subscription would exceed the cap, the server replies
  with `{ ok: false, error: "too_many_watches" }` and logs a warning.

**Session subscriptions cleanup** (`SessionSubscriptions` in `ws/session-subscriptions.ts`):
- `ws-server.ts` gained an optional `onSessionClose` hook, called from the `ws.on("close")`
  handler (guarded with try-catch to prevent a callback failure from breaking socket teardown).
- `bootstrap.ts` wires `onSessionClose: (s) => subscriptions.disposeSession(s)`, disposing every
  file-watch and git-checkout subscription the moment a client disconnects, releasing OS-level
  file handles without waiting for the browser to unsubscribe first. Fixes a pre-existing leak:
  `git_checkout_subscribe` never released its `WorkspaceGitService` listener on a dropped
  connection, and this now covers both subscription families.

### File operations (`files/`)

**`file_read_request`** (`bootstrap.ts`/`dev-bootstrap.ts`, now `async`):
- Reads a file synchronously into the WS response — **now uses `async` `stat` / `readFile` from
  `node:fs/promises`** instead of the prior synchronous `statSync`/`readFileSync`. Before: a
  multi-MB UTF-8 decode blocked the entire event loop (all agent streams, terminal bytes,
  heartbeats shared this thread). After: long reads yield back to the event loop between chunks.
- Size check: if `size > MAX_INLINE_FILE_READ_BYTES` (5 MiB in `files/limits.ts`, raised from a
  512 KiB literal previously duplicated in both bootstrap files), returns
  `{ ok: false, error: "file_too_large", size, maxBytes: MAX_INLINE_FILE_READ_BYTES }`.
- **Additive optional `maxBytes` field** in the `file_too_large` response: lets clients render an
  accurate cap without hardcoding the server's number. The `error` code and `size` field are
  unchanged (append-only wire contract).
- `~`/`~/` expansion via the shared `expandHome` helper (`resolve-path.ts`, task-001 sprint-045 —
  previously six duplicated inline checks across this file, `dev-bootstrap.ts`, `file-watch-
  rpc.ts`, and `file-watch-service.ts`; now one implementation).

**`file_transfer.ts`** (task-001, sprint-045 — closed the tilde/MIME gaps below):
- Issued download tokens (`file-transfer.ts`, `FileTransferService`) are short-lived and stored in
  a registrar (`download-token-store.ts`).
- `file_download_token_request` now expands `~`/`~/` via `expandHome` before `realpath()` —
  previously the one file-path RPC with no tilde expansion at all, which is what blocked a
  `~`-prefixed inline-image download (features/inline-image-rendering.md).
- `startDownload`'s `Begin` frame now carries `meta.mimeType` (via `file-explorer.ts`'s exported
  `mimeHintForFile`), so `FileTransferClient` no longer relies on browser blob-URL sniffing for a
  known extension; an unknown extension still falls back to `application/octet-stream`.
- File downloads happen over the WebSocket via binary frames, not HTTP.
- Unbounded file size (no inline ceiling like `file_read_request`).

**`file-explorer.ts`** (directory listing + preview):
- Scans directories, reports stat metadata + MIME types + inline text/binary previews (inlined,
  unlike download tokens, so no temp storage needed for small files).
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

- `GET /api/health` → `{ status: "ok" }` (unauthenticated, exempt from Host + auth checks)
- Host-header allowlist (403 on mismatch) → CORS headers (`daemon.cors.allowedOrigins`) → optional
  bearer auth → delegates to an injected `onRequest` handler else 404. The daemon wires `onRequest`
  to the service proxy (`proxy/service-proxy.ts`) only — there is no HTTP file-download route;
  file downloads happen over the WebSocket via binary frames (`files/file-transfer.ts`), not HTTP.
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
- **`AgentManager` is the only place that mutates or persists an agent record.** Status changes go
  through `manager.setStatus(agentId, newStatus)`; any other field (title, labels, config, …)
  goes through `manager.updateRecord(agentId, patch)`. Never mutate `managed.record` directly from
  an RPC handler — it will show up over the WS broadcast but silently fail to reach
  `agents/**.json` on disk (this exact bug broke session rename until both `update_agent` and
  `agent_set_session_name_request` were routed through `updateRecord`).
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
  `relayReply` and `relayReplyBinary` are captured from `connectRelay`'s `onHandshake` callback
  (which now hands over the channel's `send`/`sendBinary` directly, the moment the handshake
  completes), and reset (`= null`) alongside `resetRelaySession()` on `onReconnect`, or a stale
  reply closure from a dead relay socket could be invoked. They used to be captured lazily from
  `onMessage`/`onBinaryMessage` instead — fine for `relayReply` (the client's first frame is
  always the text `hello`), but `relayReplyBinary` stayed `null` until the daemon received a
  BINARY frame from the client. Terminal I/O sends one immediately (`Input`), masking the bug;
  file downloads never do — the client only ever sends TEXT
  (`file_download_token_request`/`file_download_request`) and expects unprompted BINARY
  `Begin`/`Chunk`/`End` back — so every relay-routed file download silently hung forever with no
  error on either side. Regression test: `bootstrap.test.ts`'s "file download round-trips
  Begin/Chunk/End BINARY frames over relay with no inbound binary frame ever sent by the client
  first". Terminal I/O and file-transfer chunks ride this binary path — they are real binary
  application data, but they cross the relay wire as base64-wrapped JSON text frames
  (`@av-pi-studio/relay`'s `e2ee_bin`), never raw binary WebSocket frames; see that package's
  AGENTS.md § Wire format for why.

---

---

## Documentation

| Document | Scope |
| --- | --- |
| `docs/gateway-architecture.md` | System topology: client → WS → router → services → providers. The full flow of a user prompt from send to daemon to `pi` process to broadcast. **Read this for the big picture.** |
| `docs/rpc-communication.md` | RPC request/response mechanics: the two correlation layers (WebSocket ↔ daemon, daemon ↔ `pi`), the handler contract, broadcast semantics, client-side reconnect/backfill, and a recipe for adding a new RPC. **Read this to understand how the communication works.** |

## Testing

```bash
npx vitest run packages/server
```

Each subsystem has co-located `*.test.ts` files. Provider tests inject stub transports;
persistence tests use temporary directories; WS tests use in-memory session stubs.
