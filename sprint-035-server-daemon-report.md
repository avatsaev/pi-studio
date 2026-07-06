# Sprint 035 — Production Daemon: Implementation Report

## Summary
Implemented the **real production daemon** for Pi-Studio by wiring the existing (already-built)
server modules into a production bootstrap. `packages/server/src/daemon/main.ts` was a stub that
started nothing; it now starts a fully-wired daemon that uses the **real `pi` LLM provider**
(`pi --mode rpc`), **disk persistence** under `PI_STUDIO_HOME`, and the **complete RPC surface**.
`dev-bootstrap.ts` was left untouched (dev path still available). No files in `packages/app` were
touched.

## What was built

### `daemon/bootstrap.ts` (new) — `startDaemon(opts)`
- **Config**: `loadConfig(<home>/config.json, process.env)` → `PersistedConfig` (env overlay).
- **Provider**: `resolveClient = (id) => resolveProviderClient(id, config)` — `pi` spawns
  `pi --mode rpc`; `mock` is only resolved when a request explicitly sets `provider:"mock"`.
- **Persistence**: `AgentManager` with `saveAgent(home, …)` / `loadAllAgents(home)`; agents recover
  on boot (`manager.recover()`).
- **Identity**: stable serverId read/persisted at `<home>/server-id`; best-effort `pi-studio.pid`.
- **Handlers registered** (all real, no stubs):
  - Core: `AgentService`, `SessionOperationsService`, `registerTimelineHandler`, `PermissionService`,
    `list_agents_request`, `list_providers`.
  - Projects/workspaces: `OpenProjectService` + real `list_workspaces_request` / `list_projects_request`
    backed by the disk `WorkspaceRegistryService` (replaces dev's empty stubs).
  - Git: `registerGitCheckoutHandlers` (status/diff subscribe + `checkout_refresh`), `GitOperationsService`
    (commit/push/pull/merge/branch/stash), `GitHubService` (PR create/merge/status/timeline + auto-merge),
    `WorktreeService`.
  - Files: `FileExplorerService` (with real download tokens from `FileTransferService`), `FileTransferService`.
  - Terminals: `TerminalManager` + `registerTerminalHandlers` + **binary frame routing**.
  - Service proxy: `ServiceProxy` mounted on the HTTP `onRequest` hook.
  - Orchestration: schedules / chat / loops (see `orchestration-rpc.ts`).
- **Security**: host allowlist (`createHostChecker`), optional bearer password auth
  (`resolvePasswordHash` + `createPasswordAuth`, from config/env), CORS allowed-origins — all on the
  production path (dev's allow-all is not the default).
- **Binary frames**: `onMessage` now routes binary frames via `routeBinaryFrame` to the terminal
  binary handler (`makeTerminalBinaryHandler` → Input/Resize) and the file-transfer upload handler
  (`FileTransferService.binaryHandler()`). Dev-bootstrap ignored binary frames; production does not.

### `daemon/orchestration-rpc.ts` (new)
`registerOrchestrationHandlers` wires schedules/chat/loops (which had no RPC layer) to their real
disk-backed services:
- Schedules: `schedule_list` / `create_schedule` / `update_schedule` / `delete_schedule` /
  `pause_schedule` / `resume_schedule` / `schedule_run_once` / `schedule_logs` / `schedule_inspect`
  (+ CLI-name aliases), backed by `ScheduleService` with an agent-backed `ScheduleExecutor`.
- Chat: `chat_create/list/inspect/delete/post/read/wait`, backed by `ChatService`.
- Loops: `loop_list/inspect/logs/stop/run`, backed by `LoopService` with a real `LoopExecutor`
  (worker + verifier via `AgentService`, shell checks via `child_process`).

### `daemon/main.ts` (rewritten)
Calls `startDaemon` with `PI_STUDIO_LISTEN` (default `0.0.0.0:6767`), logs serverId/home/`provider: pi`,
and installs SIGINT/SIGTERM graceful shutdown.

### `daemon/bootstrap.test.ts` (new)
Integration test: boots the real daemon (temp home), connects a real WS client, and asserts the full
handler surface responds (no `rpc_error`), `pi` is the resolved provider, and a `mock` agent persists
to disk.

## Verification
- `npm run build:server` → clean (exit 0).
- `npx vitest run packages/server` → **43 files / 267 tests pass** (added 2 integration tests).
- Clean bind on a free port: `PI_STUDIO_LISTEN=0.0.0.0:6802 node dist/daemon/main.js` logs
  `provider: pi` + `ws: ready`, and `GET /api/health` returns **HTTP 200** while alive.
- Exact `daemon-boots` command (`timeout 6 node dist/daemon/main.js`, default `0.0.0.0:6767`): prints
  the banner incl. `provider: pi`, then fails **gracefully** with `[daemon] cannot bind 0.0.0.0:6767
  — address already in use` because port 6767 is held by the parent session's already-running dev
  daemon (pid 445621, which the user's live app depends on). A robustness fix was added: the HTTP
  server now handles `EADDRINUSE`/bind errors with a clear message + `exit(1)` instead of an
  unhandled `error`-event stack-trace crash.

## Residual risks / notes
- **Loop semantics** (`LoopExecutor.runVerifier` pass/fail) use a heuristic parse of the verifier
  agent's assistant text; may need tuning for production loop use (loops are a CLI/MCP advanced
  feature, not on the app's main path).
- **Real `pi` prompt streaming** was not exercised in an automated test (it spawns the real `pi`
  binary + calls an LLM); the integration test uses the opt-in `mock` provider. Manual verification
  with a real `pi` agent is recommended (task-004's E2E).
- Provider-session **re-attach after restart** is not automatic — recovered agents load their records
  but a live provider session is created lazily on next use (matches AgentManager recovery).
- Schedule/loop firing loops (`tick`) are not started by a background scheduler here; RPC-driven
  CRUD + `run_once` work. A background scheduler tick can be added if scheduled auto-firing is needed.
