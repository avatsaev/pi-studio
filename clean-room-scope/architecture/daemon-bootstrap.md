# Daemon Bootstrap & Lifecycle — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [websocket-protocol.md](websocket-protocol.md), [relay-e2ee.md](relay-e2ee.md),
> [auth-security.md](auth-security.md), [persistence.md](persistence.md), [config.md](config.md)

## Purpose

The daemon is the single long-lived server process that owns all agent state and exposes the
WebSocket API. Bootstrap wires together the HTTP server, WebSocket server, agent manager, all
persistence stores, the MCP server, optional relay transport, and the service proxy, then begins
listening. Exactly one daemon may own a given `$PI_STUDIO_HOME`, enforced by a PID lock.

## Public Contract

### Entry points
| Name | Purpose |
|------|---------|
| `bootstrap()` (server) | Initialize and start all subsystems; returns a handle with `close()` |
| `daemon-worker.ts` | Process entry that runs the daemon (spawned by CLI/desktop or directly) |
| HTTP `GET /api/health` | Liveness probe; exempt from auth and host checks |
| HTTP `/mcp/agents` | MCP server endpoint for agents |
| WebSocket upgrade (root) | Client connections |

### Startup inputs
- `$PI_STUDIO_HOME` (env `PI_STUDIO_HOME`, default `~/.pi-studio`) — state directory.
- `PI_STUDIO_LISTEN` (default `127.0.0.1:6767`) — listen address `host:port`.
- `config.json` — daemon config (see [config.md](config.md)).
- Optional `PI_STUDIO_SERVER_ID`, `PI_STUDIO_PASSWORD`, `PI_STUDIO_HOSTNAMES`, relay/service-proxy env.

## Behavior & Algorithms

```
function bootstrap():
    home = resolvePi-StudioHome()                 # PI_STUDIO_HOME or ~/.pi-studio
    ensureDirectoryLayout(home)               # agents/, schedules/, chat/, projects/, loops/
    acquirePidLock(home/pi-studio.pid)            # fail fast if another live daemon owns this home
    serverId = loadOrCreateServerId(home)     # "srv_<base64url>", overridable by env
    keypair  = loadOrCreateDaemonKeypair(home)# libsodium box keypair, mode 0600, regenerate if unreadable
    config   = loadConfig(home/config.json)   # Zod-validated, normalized (legacy migrations)
    logger   = createLogger(config.log)       # pino to file (rotating) + console

    stores   = openStores(home)               # agent, schedule, loop, chat, project, workspace, push
    agentMgr = new AgentManager(stores, providerRegistry, logger)
    agentMgr.recover()                        # rehydrate persisted agents; running loops → stopped

    httpServer = createHttpServer({ healthRoute, mcpRoute, fileDownloadUpload, serviceProxy })
    wsServer   = createWebSocketServer(httpServer, { agentMgr, session factory, auth, hostCheck })

    if config.daemon.relay.enabled:
        relay = connectRelay(keypair, config.daemon.relay)   # outbound, E2EE
    if serviceProxyConfigured:
        startServiceProxy(config | env)

    httpServer.listen(PI_STUDIO_LISTEN)
    writePidFile({ pid, startedAt, listen })
    return { close() }                        # graceful shutdown
```

- **PID lock:** `pi-studio.pid` stores `{ pid, startedAt, ... }`. On startup, if the file exists and the
  recorded PID is alive, abort with a clear "another daemon is running" error. Stale locks (dead
  PID) are reclaimed.
- **Server id:** stable per-`$PI_STUDIO_HOME`; persisted as plain text `srv_<base64url>`. Used as
  `serverId` in the hello/`server_info` response so clients can recognize the same daemon across
  reconnects.
- **Recovery:** agents are reloaded from disk; their runtime is *not* automatically resumed but
  records are available. Loops with `status: "running"` are recovered as `"stopped"` with an
  interruption log entry.

### Shutdown
```
function close():
    stop accepting new connections
    close relay transport (if any)
    close all sessions
    close agent runtimes (kills child processes)
    flush stores
    release pid lock
```

> **Critical operational rule:** the production daemon on port `6767` manages all running agents;
> restarting it kills every agent process. Never restart without explicit user intent.

## Data & Persistence
- Reads/creates: `pi-studio.pid`, `server-id`, `daemon-keypair.json`, `config.json`, all store files,
  `daemon.log`. See [persistence.md](persistence.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Another daemon owns `$PI_STUDIO_HOME` | Abort startup with clear error; do not double-bind |
| Stale PID file (dead process) | Reclaim lock and continue |
| Unreadable keypair file | Regenerate keypair |
| Corrupt config | Fall back to defaults where possible; reject hard-invalid fields |
| Listen address in use | Fail fast with bind error |

## Dependencies
- Internal: all stores, agent manager, websocket server, relay transport, service proxy, MCP server.
- External: Node HTTP/WS, libsodium, pino.

## Acceptance Criteria
- [ ] Starting two daemons against the same `$PI_STUDIO_HOME` fails the second with a lock error.
- [ ] `GET /api/health` returns success without auth or host validation.
- [ ] After restart, persisted agents reload and previously-running loops appear as `stopped`.
- [ ] `serverId` is stable across restarts for the same home.
- [ ] Graceful shutdown kills agent child processes and releases the PID lock.

## TODO(verify)
- [ ] Exact PID-file JSON shape and reclaim heuristics.
- [ ] Whether any agents auto-resume on boot vs. resume-on-demand only.
