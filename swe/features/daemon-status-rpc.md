# Feature — Daemon Status RPC (`daemonObservability`: status, clients, subscribe push)

> **Status: shipped** (sprint-084 status, sprint-085 logs + flag; dashboard stage 2)

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [daemon-log-streaming.md](daemon-log-streaming.md) (same flag, same subscription
> conventions), [self-update.md](self-update.md) (owns replacing the hard-coded `server_info.version`;
> shares `SERVER_VERSION`), [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)
> (flags, RPC naming, per-session subscription pushes), [../architecture/daemon-bootstrap.md](../architecture/daemon-bootstrap.md),
> [../architecture/relay-e2ee.md](../architecture/relay-e2ee.md) (relay `Session`),
> [../architecture/auth-security.md](../architecture/auth-security.md),
> [../architecture/external-client-fixtures.md](../architecture/external-client-fixtures.md)
> Source brief: [daemon-monitoring-dashboard.md](../../../pi-studio-dashboard/swe/grills/daemon-monitoring-dashboard.md)
> (D4, D5, D26, D30, D31, D33)

## Purpose

Nothing about the daemon *as a process* is visible over the wire today: no version, uptime, memory,
CPU, event-loop health, agent counts, or who is connected (brief "Daemon-level observability").
`daemonStatusRpc` is advertised in `server_info.features` but has no handler and is **left untouched**
(D30). This scope adds a read-only observability API under a **new** server feature flag
`daemonObservability` (shared with [daemon-log-streaming.md](daemon-log-streaming.md)):

- `daemon_status_request` → `daemon_status_response { payload: DaemonStatus }` (one-shot);
- `daemon_status_subscribe_request` / `daemon_status_unsubscribe_request` → per-session push of
  `daemon_status_update { payload: DaemonStatus }` every 5 s, to subscribers only (D30);
- retention of the hello's `appVersion` (and other connection facts) on the server `Session` so the
  connected-clients list can show it (the dashboard tags itself `pistudiodashboard/<version>`, D23).

Read-only; any authenticated client may call it, like every other RPC (D31; the daemon's
`0.0.0.0` default is a separate bug, D35 — see `../MAIN-SCOPE.md` § 10).

## Current state (verified in code)

- `daemonStatusRpc` is in `SERVER_FEATURES` and folded into every `server_info.features`; grep finds
  no handler. `features.daemonStatusRpc === true` therefore means nothing; do not reuse it (D30).
- `server_info.version` is the literal `"1.0.0"` (direct WS: `bootstrap.ts` `createWebSocketServer`
  deps; relay handshake `bootstrap.ts`), `"0.1.0-dev"` in `dev-bootstrap.ts`. `serverInfoPayloadSchema.version`
  is already an optional string. **No consumer reads it**: grep across `packages/{client,web-client,
  cli,desktop,relay}/src` finds none (the web UI shows its own `__APP_VERSION__`; only
  `ws-server.test.ts` injects `"9.9.9"`). [self-update.md](self-update.md) already specifies replacing
  it everywhere with `SERVER_VERSION`.
- `SERVER_VERSION` exists in `packages/server/src/extensions/curated-packs.ts`
  (`createRequire(import.meta.url)("../../package.json").version`; the root `package.json` has no
  `version`; packages carry one aligned version, `0.0.115` at time of writing).
- `ws/session.ts` `Session` holds `id, clientId, clientType, capabilities, socket` — **no
  `appVersion`, `connectedAt`, `remoteAddress` or transport marker**. `helloSchema` already has
  optional `appVersion: z.string().optional()` (`messages.ts` ~l.45) but both handshakes drop it.
- Session registries: direct sessions live in `wsHandle.sessions` (a `Set<Session>` in
  `ws/ws-server.ts`, populated after a valid hello, removed on socket close); relay sessions in the
  `relaySessions` Set in `daemon/bootstrap.ts` (created lazily on the relay peer's `hello`, **at most one
  live relay session**, "last hello wins"). `getActiveSessions()` returns both.
  `ws-server.ts` has the HTTP upgrade `req` (`req.socket.remoteAddress`) in scope at handshake; the relay
  has no peer address.
- `onSessionClose` (`bootstrap.ts`) already disposes per-session subscriptions via
  `SessionSubscriptions` (`ws/session-subscriptions.ts`) — the lifecycle hook this scope reuses.
- `AgentManager` exposes `list()`/`listAll()` returning `ManagedAgent` with `record.lastStatus`.
- Per-session subscription push precedent: `checkout_status_subscribe/_update`, `file_watch_*`,
  `provider_auth_flow_event` (`sessionMessageBaseSchema` passthrough family, `messages.ts` ~l.1209);
  `session-subscriptions.ts` is the per-session disposal registry.

## Public contract

### Wire messages (flat snake_case, `session` envelope, all `.passthrough()`, new fields optional)

| Message | Direction | Payload | Notes |
|---------|-----------|---------|-------|
| `daemon_status_request` | C→S | `{ requestId }` | One-shot |
| `daemon_status_response` | S→C | `{ requestId, payload: DaemonStatus }` | `requestId` stamped by `ws/router.ts` |
| `daemon_status_subscribe_request` | C→S | `{ requestId }` | Idempotent per session |
| `daemon_status_subscribe_response` | S→C | `{ requestId, payload: { ok: true, intervalMs: 5000, status: DaemonStatus } }` | Includes an immediate first snapshot so the client need not also call the one-shot (saves a round trip); `ok:false, error` only for `not_supported` (never today) |
| `daemon_status_unsubscribe_request` | C→S | `{ requestId }` | Idempotent |
| `daemon_status_unsubscribe_response` | S→C | `{ requestId, payload: { ok: true } }` | |
| `daemon_status_update` | S→C (push) | `{ payload: DaemonStatus }` | Flat push, **only** to subscribed sessions, every 5 s while subscribed; carries no `requestId` |

Domain failures are payload-level `{ok:false,error}` (router cannot choose an `rpc_error` code —
`extension-ui-rpc.md` § Error convention). Subscribe-without-flag is a protocol error handled by the
client gating on the flag (D26).

```ts
interface DaemonStatus {
  version: string;                 // SERVER_VERSION (real, package.json) — never the "1.0.0" placeholder
  startedAt: number;               // epoch ms, process-level (Date.now() at bootstrap start)
  uptimeMs: number;                // monotonic: performance.now()-based, not Date.now() - startedAt
  pid: number;                     // process.pid
  nodeVersion: string;             // process.version
  memory: { rss: number; heapUsed: number; heapTotal: number };   // bytes, process.memoryUsage()
  cpuPercent: number;              // 0..(100*cores); % of ONE core over the last sample window; 0 until 2nd sample
  eventLoopLagMs: number;          // mean event-loop delay over the last window (ms, ≥ 0)
  agentsByStatus: Record<string, number>;   // lastStatus → count, archived agents excluded; only non-zero keys
  clients: DaemonClientInfo[];
}
interface DaemonClientInfo {
  clientId: string;
  clientType: string;              // as sent in hello (open string on this side; strict enum at hello)
  appVersion?: string;             // hello.appVersion, verbatim, when sent
  connectedAt: number;             // epoch ms of the handshake
  remoteAddress?: string;          // direct sessions only (socket peer); absent for relay
  transport: "direct" | "relay";
}
```

- `DaemonStatus` and `DaemonClientInfo` are `.passthrough()` objects; fields only ever **added**.
- `agentsByStatus` keys are the `agentStatusEnum` values the daemon holds
  (`initializing|idle|running|error|closed`); clients treat unknown keys as unknown (D26).
- `clients` includes **the requesting session itself** (the dashboard checks for its own
  `appVersion`, brief acceptance 15). Ordered by `connectedAt` ascending, ties by `clientId`.
- A client listed by `clientId` may appear more than once (same `clientId` reconnected before the old
  socket closed, or two tabs); entries are per live `Session`, never merged.
- `remoteAddress` is as seen by the daemon (IPv4/IPv6 literal, possibly `::ffff:`-mapped,
  possibly a reverse-proxy address); it is an operator-visible fact, not a trusted identity.

### Capability flag

- `SERVER_FEATURES.daemonObservability` in `packages/protocol/src/client-capabilities.ts` + COMPAT
  entry; exact-key-set test updated (precedent `extensionUi`). One flag covers the status family
  **and** [daemon-log-streaming.md](daemon-log-streaming.md): the brief names a single flag (D30) and
  the two ship together.
- `daemonStatusRpc` is neither removed, renamed nor given a handler.

### Session metadata (server-internal contract)

`Session` gains read-only fields: `connectedAt: number`, `appVersion?: string`,
`remoteAddress?: string`, `transport: "direct" | "relay"`. Constructor options gain the same (all
optional with defaults: `connectedAt = Date.now()`, `transport = "direct"`) so existing tests that
construct `Session` are unaffected. `ws-server.ts` passes `appVersion: hello.data.appVersion` and
`remoteAddress: req.socket.remoteAddress`; the relay handshake in `bootstrap.ts` passes
`appVersion` and `transport: "relay"`.

### `server_info.version` (decision)

**Included, via [self-update.md](self-update.md)'s existing requirement** (same `SERVER_VERSION` at
all three handshake sites, replacing `"1.0.0"` ×2 and `"0.1.0-dev"`). Safety verified: zero code
consumers (§ Current state), optional wire field, no schema change. `DaemonStatus.version` and
`server_info.version` MUST be the same value (single exported constant; the helper moves out of
`extensions/curated-packs.ts` into a neutral `packages/server/src/version.ts` re-exported by
curated-packs, whichever of the two features lands first performs the move). Not a prerequisite of
the status RPC — `DaemonStatus.version` is correct regardless.

### New/changed files

| File | Responsibility |
|------|----------------|
| `packages/protocol/src/messages.ts` (+ tests) | Request/response/update schemas (`.passthrough()`), `daemonStatusSchema`, `daemonClientInfoSchema`, union entries |
| `packages/protocol/src/client-capabilities.ts` (+ test) | `daemonObservability` flag + COMPAT entry |
| `packages/server/src/version.ts` (new) | `SERVER_VERSION` single source |
| `packages/server/src/ws/session.ts` | New metadata fields (above) |
| `packages/server/src/ws/ws-server.ts` | Populate `appVersion`, `remoteAddress` |
| `packages/server/src/daemon/bootstrap.ts` + `dev-bootstrap.ts` | Populate relay session metadata; construct `DaemonStatusService`; register handlers; hook `onSessionClose`; real `version` in handshakes |
| `packages/server/src/observability/daemon-status-service.ts` (new) | Sampling, snapshot build, subscriber set, shared timer |
| `packages/server/src/observability/daemon-status-rpc.ts` (new) | `registerDaemonStatusHandlers(registry, deps)` (service + `-rpc` pair convention) |
| `packages/protocol/fixtures/external-clients/` | `daemon_status_*` fixtures ([external-client-fixtures.md](../architecture/external-client-fixtures.md)) |
| `packages/server/AGENTS.md`, `packages/protocol/AGENTS.md` | Document |

## Behavior & algorithms

Field sources:

| Field | Source |
|-------|--------|
| `version` | `SERVER_VERSION` |
| `startedAt` | `Date.now()` captured once when the service is constructed in bootstrap (process-level; a daemon restart resets it) |
| `uptimeMs` | `Math.round(performance.now())` since process start is **not** daemon start; use `performance.now() - startMonotonic` where `startMonotonic = performance.now()` captured with `startedAt`. Immune to wall-clock steps |
| `pid`, `nodeVersion` | `process.pid`, `process.version` |
| `memory` | `process.memoryUsage()` — `rss`, `heapUsed`, `heapTotal`. Not `memoryUsage.rss()` per-sample variants needed; one cheap call per snapshot |
| `cpuPercent` | delta of `process.cpuUsage()` (user+system µs) between two consecutive samples divided by elapsed monotonic µs × 100; first sample has no baseline → `0` |
| `eventLoopLagMs` | `perf_hooks.monitorEventLoopDelay({resolution: 20})` histogram, **mean** (ns→ms) over the window since the last read, then `reset()`; enabled only while ≥ 1 subscriber or during a one-shot (see below) |
| `agentsByStatus` | iterate `manager.list()` (non-archived — verify `list()` excludes archived, § TODO), count `record.lastStatus` |
| `clients` | `getActiveSessions()` mapped through `Session` metadata; `connectedAt` from `Session` |

```
DaemonStatusService:
    subscribers: Set<Session>
    timer: Timeout | null
    histogram: IntervalHistogram | null
    lastCpu: { usage: CpuUsage, atMs: number } | null

    snapshot(): DaemonStatus
        now = performance.now()
        cpu = process.cpuUsage()
        percent = lastCpu ? ((cpu.user+cpu.system) - (lastCpu.user+lastCpu.system)) / ((now-lastCpu.atMs)*1000) * 100
                          : 0
        lastCpu = { cpu, now }
        lag = histogram ? histogram.mean/1e6 (0 if NaN) : 0 ; histogram?.reset()
        return DaemonStatus built from the table above

    oneShot(session):                             # daemon_status_request
        # no subscribers => no running histogram: lag reports 0 and cpuPercent is 0/last-window.
        ensureSampling()   # starts histogram + a baseline cpu sample if not already running
        ... build snapshot() ; if no subscribers, stop sampling again
        # => a one-shot's cpuPercent/lag are only meaningful when sampling already runs; documented
        #    client behavior: use subscribe for live gauges, one-shot for static facts. (D33)

    subscribe(session):
        subscribers.add(session); registerDispose(session, () => unsubscribe(session))
        if timer == null: histogram = monitorEventLoopDelay({resolution: 20}); histogram.enable();
                          lastCpu = now baseline; timer = setInterval(tick, 5000); timer.unref()
        reply { ok: true, intervalMs: 5000, status: snapshot() }

    tick():
        if subscribers empty: stopSampling(); return
        status = snapshot()                       # ONE snapshot shared by all subscribers
        frame  = serialize once { type:"session", message:{ type:"daemon_status_update", payload: status } }
        for s in subscribers: try s.send(frame-equivalent) catch -> drop s    # dead socket

    unsubscribe(session):
        subscribers.delete(session); if empty: stopSampling()   # clearInterval + histogram.disable()

    stopSampling(): clearInterval(timer); timer = null; histogram.disable(); histogram = null; lastCpu = null
```

- **One shared timer, only while ≥ 1 subscriber** (D33): no timer, no histogram, no allocation when
  nobody subscribed; the timer is `unref()`ed so it never holds the process open.
- Subscribers are per `Session` (not per `clientId`): a second tab with the same `clientId`
  subscribes independently; `onSessionClose` removes only that session. Re-subscribing an already
  subscribed session is a no-op that still returns a fresh snapshot.
- Sampling cost per tick: one `memoryUsage()`, one `cpuUsage()`, one histogram read/reset, an O(agents)
  count (≤ 500 target, D28), an O(clients) map, and one `JSON.stringify` of a ~1 KB object (+ ~120 B
  per client). Budget **< 1 % of one core** at the 10-client / 500-agent target (D33) — in practice
  microseconds per 5 s; measured by the acceptance test.
- The push is sent with the same envelope form as other per-session pushes (`{type:"session",
  message:{type:"daemon_status_update", payload}}`) by `session.send`, wrapped in try/catch like
  `broadcast` helpers (dead sockets are ignored; their `onSessionClose` cleans up).
- The relay session is a normal `Session`; subscribing over the relay works, and its client entry is
  `transport:"relay"`, no `remoteAddress`.

## Data & persistence touchpoints

- No persistence. All state (subscriber set, timer, histogram, last CPU sample) is in memory and
  process-lifetime; a restart resets `startedAt`/`uptimeMs`, and clients reconnect and re-subscribe
  (D25, D8).
- `Session` metadata is held in memory for the connection's life only. `appVersion` is **not** added
  to the persisted per-`clientId` capability store (`ws/capability-store.ts`): it is a connection
  fact, not a capability, and must reflect the *current* hello.
- No new config key, env var or file.

## Error handling & edge cases

| Condition | Behavior |
|-----------|----------|
| Old daemon (flag absent) | Client does not send; if sent, router returns `rpc_error` `unknown_message_type` — clients gate on the flag (D26) |
| Client disconnects while subscribed | `onSessionClose` → `unsubscribe`; last one out stops the timer |
| `session.send` throws on tick | Subscriber dropped silently; others unaffected |
| Slow client (no backpressure in `ws`, brief "Replay / backpressure") | At 5 s × ~1 KB the load is negligible; no per-subscriber queue |
| Hello without `appVersion` | `appVersion` omitted from `clients[]` entry |
| Two clients, same `clientId` | Two entries |
| Relay peer replaced ("last hello wins") | `resetRelaySession` removes the old Session from `relaySessions`; its subscription is disposed via the same close path — resolved: the relay path did not invoke `onSessionClose`, so `resetRelaySession` now disposes the subscription explicitly |
| Zero agents | `agentsByStatus: {}` |
| `process.cpuUsage()` first sample | `cpuPercent: 0` |
| `monitorEventLoopDelay` returns NaN before any sample | `eventLoopLagMs: 0` |
| Wall-clock jump | `uptimeMs` unaffected (monotonic); `startedAt`/`connectedAt` are wall-clock facts |
| Dashboard computing "x ago" | Uses its local clock; daemon timestamps shown in local time, skew accepted (D28) |
| Huge client count | `clients[]` unbounded in this scope; practical cap = live sessions; decision: stay uncapped |
| Hostile client spams subscribe/unsubscribe | Each call is O(1); no amplification; rate limiting is not part of this scope (consistent with all other RPCs) |

## Non-functional

- **Cost (D33):** < 1 % of one core with ≥ 1 subscriber at 10 clients / 500 agents; exactly zero
  work when there are no subscribers.
- **Security (D31):** no extra gate. The data (client ids/addresses, process facts) is visible to any
  authenticated client; documented in `auth-security.md` posture. `remoteAddress` discloses LAN
  peers to every authenticated client — accepted by D31.
- **Compatibility (D34):** additive; absent flag ⇒ nothing changes for old clients; a stage 1
  dashboard sees `daemonObservability` absent and runs degraded (D26).
- **Observability of the observer:** the daemon logs subscribe/unsubscribe at `debug` only (no
  per-tick logging).

## Dependencies on other specs

- [daemon-log-streaming.md](daemon-log-streaming.md) — shared flag; shared per-session disposal
  hook; `onSessionClose` composes both (`SessionSubscriptions`).
- [self-update.md](self-update.md) — real `server_info.version`; shared `SERVER_VERSION`.
- [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md),
  [../architecture/daemon-bootstrap.md](../architecture/daemon-bootstrap.md) — registration in both
  bootstraps (precedent: `registerAgentUiHandlers` in both).
- [../architecture/external-client-fixtures.md](../architecture/external-client-fixtures.md) — fixtures.
- [../architecture/relay-e2ee.md](../architecture/relay-e2ee.md) — relay `Session` creation site.

## Acceptance criteria

Daemon-level tests with `startDevDaemon` (+ unit tests of the service with fake timers / injected
sampler).

- [x] **Status shape.** Given a connected client, when it sends `daemon_status_request`, then the
  response payload has all `DaemonStatus` fields with correct types: `version` equal to
  `SERVER_VERSION`, `pid === process.pid`, `nodeVersion === process.version`, `uptimeMs ≥ 0`,
  `memory.rss > 0`, `agentsByStatus` consistent with the manager. (D30)
- [x] **Clients list incl. self.** Given two connected clients (`appVersion:
  "pistudiodashboard/0.1.0"` on one), then `clients` has two entries, the requester among them,
  with the `appVersion` shown verbatim, `transport:"direct"`, a `remoteAddress`, and `connectedAt`
  within the handshake time window; entries ordered by `connectedAt`. (D23, D30)
- [x] **Relay client entry.** Given a relay-connected session, its entry has `transport:"relay"` and
  no `remoteAddress`. (D30)
- [x] **Subscribe pushes every 5 s, subscribers only.** Given client A subscribed and client B not,
  with fake timers advanced 5 s ×3, then A receives exactly 3 `daemon_status_update` frames after the
  immediate snapshot in the subscribe response, and B receives none. (D30)
- [x] **Unsubscribe / disconnect.** After `daemon_status_unsubscribe_request`, or after the socket
  closes, no further updates are sent; when the last subscriber leaves, the interval and histogram are
  stopped (no pending timers under fake timers). (D30, D33)
- [x] **No timer without subscribers.** Before any subscribe and after the last unsubscribe, the
  service holds no timer and no enabled histogram. (D33)
- [x] **One snapshot per tick.** With N subscribers, one tick calls `process.cpuUsage` and
  `memoryUsage` once (injected sampler counts) and sends N frames. (D33)
- [x] **CPU/lag gauges.** Under an injected sampler, `cpuPercent` equals the documented delta formula
  for a known usage delta; the first sample is `0`; lag NaN maps to `0`. (D30)
- [x] **Cost budget.** A benchmark/soak test with 10 simulated subscribers and 500 mock agents measures
  total sampling+serialization CPU over 60 s of fake-clock ticks (or real 5 s ticks in a nightly job)
  below 1 % of one core. (D33)
- [x] **Flags.** `server_info.features.daemonObservability` is `true` on direct and relay
  handshakes; `daemonStatusRpc` handling is unchanged (still no handler); key-set test passes. (D30)
- [x] **Real version everywhere.** `server_info.version`, on the direct, relay and dev handshakes,
  equals `DaemonStatus.version` and is not `"1.0.0"`/`"0.1.0-dev"`. (D4, D30)
- [x] **appVersion retained.** A hello with `appVersion` yields `Session.appVersion`; a hello without
  yields `undefined`; the capability store is unchanged. (D23)
- [x] **Schemas & fixtures.** All new schemas are `.passthrough()` union members; every daemon_status
  fixture parses; Layer B of the fixtures test matches live output. (D22)
- [x] **Authenticated clients only.** With a password-protected daemon, an unauthenticated WS cannot
  reach the handlers (existing auth) and an authenticated one can, with no extra role check. (D31)

## Out of scope

- Per-agent process stats (pid/cpu/mem of `pi --mode rpc` children) — brief: "No pid/cpu/mem".
- Terminals, orchestration, git metrics; disk usage; network throughput.
- Historical metrics/persistence, alerting.
- A role/ACL gate (D31); changing the default listen address (D35).
- Replacing `daemonStatusRpc` semantics (D30).

## TODO(verify) — resolved (sprint-084)

- [x] `AgentManager.list()` excludes archived agents, so `agentsByStatus` uses it directly
  (`listAll()` is not needed). Verified by `daemon-status-e2e.test.ts` (archived agent not counted).
- [x] Relay close path: a replaced relay `Session` did NOT run `onSessionClose`. `resetRelaySession`
  now calls `daemonStatusService.disposeSession` next to `subscriptions.disposeSession`.
- [x] `startedAt` = service construction time, i.e. bootstrap start (a daemon restart resets it).
- [x] `clients[]` stays uncapped (practical cap = live sessions); `remoteAddress` is exposed for
  every peer. Revisit only if a real deployment reports oversized frames.
- [x] Baseline alignment: both bootstraps construct the service at the same point, just before
  the `AgentManager`.
- [x] `Session` metadata defaults (`transport:"direct"`, `connectedAt` = construction time) keep
  tests that construct `Session` directly valid; no test asserted on the `Session` shape.

### Refinements recorded at implementation

- No `curated-packs` re-export was added for the new schemas.
- The `daemonObservability` feature flag moved to sprint-085/task-005 (shipped); the status handlers were
  registered but unadvertised until then.

## Acceptance evidence (sprint-084/085)

| Criterion | Evidence |
|---|---|
| Status shape, clients list incl. self, archived excluded | `daemon-status-e2e.test.ts` (one-shot shape; non-archived counts; clients ordered with `appVersion`) |
| Relay client entry | `daemon-status-service.test.ts` (relay transport, no `remoteAddress`) |
| Subscribe pushes, subscribers only; unsubscribe/disconnect; no timer without subscribers; one snapshot per tick; CPU/lag gauges | `daemon-status-e2e.test.ts` (push/stop/close); `daemon-status-service.test.ts` |
| Cost budget | `daemon-status-service.test.ts` (10 subscribers, 500 agents, 60 s of ticks < 1 %); combined status+logs real-time run recorded in sprint-085/task-006 summary: 0.83 % of one core |
| Flags | `daemon-status-e2e.test.ts` (`daemonObservability` true, `daemonStatusRpc` still rpc_error); `bootstrap.test.ts` relay handshake; `client-capabilities.test.ts` key set |
| Real version everywhere | `server-version.test.ts`; `daemon-status-e2e.test.ts` |
| appVersion retained | `daemon-status-e2e.test.ts`, `ws-server.test.ts` |
| Schemas & fixtures | `session-messages.test.ts`; `external-fixtures.test.ts` (Layer A) + `external-fixtures-e2e.test.ts` (Layer B), stage 2 fixtures |
| Authenticated only | `daemon-status-e2e.test.ts` (password-gated harness) |
