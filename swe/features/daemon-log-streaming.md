# Feature — Daemon Log Streaming (`daemonObservability`: live log tail)

> **Status: shipped** (sprint-084 status, sprint-085 logs + flag; dashboard stage 2)

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [daemon-status-rpc.md](daemon-status-rpc.md) (same flag, same per-session
> subscription conventions), [../architecture/daemon-bootstrap.md](../architecture/daemon-bootstrap.md)
> (logger construction), [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md),
> [../architecture/auth-security.md](../architecture/auth-security.md),
> [../architecture/external-client-fixtures.md](../architecture/external-client-fixtures.md)
> Source brief: [daemon-monitoring-dashboard.md](../../../pi-studio-dashboard/swe/grills/daemon-monitoring-dashboard.md)
> (D4, D26, D29, D30, D31, D33)

## Purpose

The daemon's structured logs exist only locally (stdout and rotating NDJSON at
`$PI_STUDIO_HOME/logs/pi-studio.log`); a remote monitor cannot see them (brief "Daemon-level
observability"). This scope lets an authenticated client subscribe to a **live, filtered, rate-capped
tail** of the daemon's own logger output:

- `daemon_logs_subscribe_request { minLevel, tail ≤ 1000 }` → backlog of the last `tail` matching
  lines, then pushes `daemon_log_lines { lines: LogLine[], dropped: number }`;
- `daemon_logs_unsubscribe_request`;
- server-side cap of **200 lines/s per subscriber** with a `dropped` counter (D30).

Shares the `daemonObservability` flag with [daemon-status-rpc.md](daemon-status-rpc.md). Read-only,
any authenticated client (D31; listen-default fix is separate, D35).

## Current state (verified in code)

- `packages/server/src/logging/logger.ts`: `createLogger(options)` builds `pino(base,
  multistream(streams))` where streams are (1) stdout — `pino-pretty` on a TTY, raw NDJSON otherwise —
  and (2) when `logDir` is set, a `rotating-file-stream` named `pi-studio.log` (`size` default `"10M"`,
  `maxFiles` 5). Each multistream entry carries its own `level`. `createDaemonLogger(home, opts)`
  defaults `logDir` to `<home>/logs`; `createDaemonLogger(undefined)` is the stdout-only dev logger;
  `silentLogger()` short-circuits before any stream. Level from `options.level` else
  `PI_STUDIO_LOG_LEVEL` else `info`. `base` is `options.bindings` (e.g. `{name:"pi-studio"}`).
- `bootstrap.ts` uses `opts.logger ?? createDaemonLogger(home)`; `dev-bootstrap.ts` uses
  `opts.logger ?? createDaemonLogger(undefined)`. Tests inject `silentLogger()`.
- **No `redact` configuration exists** (grep of `packages/server/src`: none). Redaction is by
  convention at call sites: services avoid logging payloads (e.g. `agent-ui-service.test.ts` asserts a
  secret in a UI payload never reaches log args; `agent-service` logs `promptChars`, not the prompt;
  provider-auth never interpolates prompt values). Logged fields include `clientId`, `clientType`,
  `remoteAddress`, `host` header, error messages (`err`), agent ids, paths.
- `LogLine` source format is pino's default NDJSON: `{"level":30,"time":<epoch ms>,"msg":"…",<bindings>,
  <fields>}` with numeric levels (trace 10, debug 20, info 30, warn 40, error 50, fatal 60); pino
  serializes `Error` under the `err` key with `type`, `message`, `stack`.
- A per-session disposal hook exists: `onSessionClose` → `SessionSubscriptions.disposeSession`.

## Public contract

### Wire messages (flat snake_case, `session` envelope, `.passthrough()`, new fields optional)

| Message | Direction | Payload | Notes |
|---------|-----------|---------|-------|
| `daemon_logs_subscribe_request` | C→S | `{ requestId, minLevel, tail? }` | `minLevel` ∈ `trace\|debug\|info\|warn\|error\|fatal`; `tail` integer 0..1000, default 0 |
| `daemon_logs_subscribe_response` | S→C | `{ requestId, payload: { ok: true, minLevel, effectiveLevel, lines: LogLine[], dropped: 0 } }` or `{ ok:false, error }` | `lines` = the backlog (≤ `tail`, oldest first). `effectiveLevel` = the daemon's own configured level if higher than `minLevel` (see Behavior). `error` ∈ `invalid_level` \| `invalid_tail` |
| `daemon_log_lines` | S→C (push) | `{ lines: LogLine[], dropped: number }` | Only to subscribed sessions; no `requestId`; `dropped` = lines suppressed since the previous push to this subscriber (0 when none) |
| `daemon_logs_unsubscribe_request` | C→S | `{ requestId }` | Idempotent |
| `daemon_logs_unsubscribe_response` | S→C | `{ requestId, payload: { ok: true } }` | |

```ts
interface LogLine {
  time: number;                    // epoch ms (pino `time`)
  level: "trace"|"debug"|"info"|"warn"|"error"|"fatal";   // mapped from pino's numeric level
  msg: string;                     // pino `msg`, "" when absent; truncated (see line cap)
  fields?: Record<string, unknown>; // remaining pino keys minus level/time/msg/pid/hostname/v; omitted when empty
}
```

- `.passthrough()` on `LogLine` and both messages; fields only ever added. Unknown future `level`
  strings are tolerated by clients (D26).
- A subscribe on an already subscribed session **replaces** its `minLevel` (and returns a fresh
  backlog if `tail > 0`); there is at most one log subscription per session.
- Re-subscribing with a different `minLevel` is how the dashboard's `logs.setMinLevel` is realised
  (the dashboard sends a new subscribe; no separate "set level" message).

### Capability flag

`SERVER_FEATURES.daemonObservability` (defined in [daemon-status-rpc.md](daemon-status-rpc.md)); no
second flag.

### New/changed files

| File | Responsibility |
|------|----------------|
| `packages/protocol/src/messages.ts` (+ tests) | Request/response/push schemas, `logLineSchema`, union entries |
| `packages/server/src/logging/log-tap.ts` (new) | `LogTap`: pino destination that parses NDJSON, maintains the ring buffer, fans out to subscribers |
| `packages/server/src/logging/logger.ts` | `CreateLoggerOptions.tap?: LogTap`; adds one extra multistream entry when present; no change to stdout/file entries |
| `packages/server/src/observability/daemon-logs-service.ts` + `daemon-logs-rpc.ts` (new) | Subscriber registry, per-subscriber filter/limiter/batcher, handlers |
| `packages/server/src/daemon/bootstrap.ts` + `dev-bootstrap.ts` | Create the `LogTap` and pass it to `createDaemonLogger` **when the bootstrap builds its own logger**; construct the service; register handlers; compose `onSessionClose` |
| `packages/protocol/fixtures/external-clients/` | `daemon_logs_*`, `daemon_log_lines` fixtures |

## Behavior & algorithms

### Tapping pino without touching file logging

`createLogger` already builds a `multistream`. When `options.tap` is given, push **one additional
entry** `{ level: <same resolved level>, stream: tap.stream }` — a `Writable` receiving each
serialized NDJSON line (pino hands multistream destinations the already-serialized string). Existing
entries (stdout, rotating file) and their levels are untouched, so file/stdout output is
byte-for-byte unchanged (acceptance). The tap entry is not added when the level is `"silent"`
(`createLogger` returns before streams) — tests with `silentLogger()` see an empty stream, which is
valid.

Consequences stated plainly:

- The tap receives only lines the daemon logger **would write** (level ≥ the daemon's configured
  level, `PI_STUDIO_LOG_LEVEL`, default `info`). A client asking for `debug` on an `info` daemon gets
  `info`+ and sees `effectiveLevel: "info"` in the subscribe response; the daemon never changes its
  logging level for a subscriber (no cost/leak amplification).
- If the logger is **injected** (`opts.logger`, e.g. tests) the bootstrap cannot attach a tap; the
  service is still registered and flag advertised, but the stream is simply empty
  (`effectiveLevel: "silent"`) — documented, not an error.

### Source of the backlog (`tail`)

Decision: **in-memory ring buffer inside `LogTap`, not re-reading the rotating file.**

- Capacity: last **1000** lines (the protocol maximum for `tail`), stored as the raw serialized
  string (≤ 8 KiB each after truncation → worst case ~8 MiB; typical lines are ~200 B).
- Rationale: (a) no file I/O or parsing on the hot subscribe path; (b) no rotation-boundary logic —
  `rotating-file-stream` rotates by size and naming is implementation-detail (§ TODO(verify)); a ring
  trivially "spans" a rotation; (c) works for the stdout-only dev logger; (d) the daemon's own tail
  of *this process lifetime* is exactly what a monitor wants (earlier runs are the file's concern).
  Cost: lines logged before the process started, or before the tap existed, are unavailable, and the
  buffer is lost on restart; accepted (brief D8: live-only).
- The ring stores every line the logger wrote (≥ daemon level); `tail` selects the most recent
  `tail` lines **that pass `minLevel`**, scanning backwards — so `tail:200, minLevel:"warn"` returns
  up to 200 warn+ lines drawn from the whole 1000-line ring (fewer if the ring holds fewer).

### Subscribe / deliver / cap

```
LogTap.stream.write(chunk):                      # per pino line (string, one JSON object + "\n")
    line = truncateForTransport(chunk)           # see line cap
    ring.push(line)  (drop oldest at 1000)
    levelNum = fast-parse of the "level" number (no full JSON.parse unless a subscriber needs it)
    for each sub in subscribers: if levelNum >= sub.minLevelNum: sub.enqueue(line)

DaemonLogsService.subscribe(session, minLevel, tail):
    validate minLevel in LEVELS else {ok:false,error:"invalid_level"}
    validate tail integer in [0,1000] (default 0) else {ok:false,error:"invalid_tail"}
    replace any existing sub for session (keep its limiter state reset)
    backlog = ring scanned backwards, keep lines with levelNum >= minLevelNum, up to `tail`, reverse to oldest-first
    sub = { session, minLevelNum, queue: [], tokens: 200, droppedSinceLastPush: 0, flushTimer }
    register disposal on session close
    reply { ok:true, minLevel, effectiveLevel, lines: parse(backlog), dropped: 0 }

Per-subscriber enqueue (rate cap — token bucket, 200 lines/s):
    refill tokens by elapsed*200 (cap 200), using a monotonic clock
    if tokens >= 1: tokens -= 1; sub.queue.push(line)
    else: sub.droppedSinceLastPush += 1                      # the line is lost for this subscriber only

Per-subscriber flush (batching, every 100 ms while queue or dropped is non-empty):
    if queue empty and dropped == 0: return
    lines = queue.splice(0, ≤ 200) mapped to LogLine (parse JSON, level number -> name, extract fields)
    try session.send({type:"session", message:{type:"daemon_log_lines", lines, dropped: droppedSinceLastPush}})
    droppedSinceLastPush = 0
    # a push with lines=[] and dropped>0 is permitted (signals loss even if the burst ended)
    on send failure: remove the subscriber
```

- **Cap = 200 lines/s per subscriber**, enforced by the bucket (burst ≤ 200). At a 100 ms flush
  interval a push carries at most ~20 sustained lines (≤ 200 in a burst second). The brief's
  "capped server-side at 200 lines/s with a dropped-lines counter" (D30) maps 1:1; `dropped` is
  **per subscriber, incremental** (lines suppressed since that subscriber's previous push).
- The ring and the file are **never** subject to the cap — only delivery is. Capped lines are not
  re-delivered; the client sees the gap via `dropped` (and may re-subscribe with `tail` to backfill).
- Backlog lines in the subscribe response are exempt from the bucket (one-time, ≤ 1000) but still
  size-bounded by the line cap; the response frame ≤ ~8 MiB worst case, far below the dashboard's
  16 MiB frame cap (D28).
- Cost (D33): with zero subscribers the tap does only the ring push per line (one string
  assignment); fan-out work scales with subscribers × matching lines, bounded by 200/s each. The
  100 ms flush timer exists only while a subscriber has pending data.

### Line cap and sanitization

- A serialized line longer than **8192 bytes** is transported truncated: `msg` truncated to 2048
  chars, `fields` values: strings truncated to 1024 chars, `err.stack` truncated to 2048 chars,
  nested objects beyond depth 4 replaced by `"[truncated]"`; the line is marked `fields.truncated:
  true`. Truncation happens **once, at tap time**, so the ring never holds an oversized line.
- A line that is not valid JSON (e.g. something wrote raw text to the logger destination) is
  delivered as `{ time: <receipt time>, level: "info", msg: <first 2048 chars> }` rather than
  dropped; the tap never throws into pino.
- `pid`, `hostname`, pino's `v` are stripped from `fields`.

### Redaction expectations

- **The daemon applies no redaction layer** (no pino `redact`); a stream therefore exposes whatever
  the daemon already writes to its log file. Existing convention keeps payloads out of logs (§ Current
  state). This feature grants the same data to any authenticated client (D31) — the log file is
  already readable by anyone with local access, and every other RPC (timeline fetch, file reads) is far
  more revealing; an authenticated client can already read agent transcripts.
- Defence in depth added by this scope: at **tap time** a conservative sanitizer drops the **values**
  of fields whose keys (case-insensitive) match `password|passwd|secret|token|authorization|cookie|
  apikey|api_key|bearer|privateKey|secretKey` (replaced by `"[redacted]"`) at any depth ≤ 4, and masks
  `pi-studio.bearer.<…>` substrings in `msg`/string fields. This affects **only the streamed copy**; the
  stdout and file entries are untouched. It is best-effort, not a guarantee (§ TODO(verify)).
- The daemon MUST NOT log permission `action` payloads, UI-request payloads or passwords (existing
  invariant, asserted for the UI service by test); this spec adds an acceptance test that a stream of a
  full agent/UI/permission scenario contains none of the scenario's sentinel secret strings.

### Per-session lifecycle

- One subscription per `Session`; dropped on `onSessionClose`, explicit unsubscribe, or send failure.
  No subscription survives a reconnect — clients re-subscribe (D25).
- Last subscriber leaving stops the flush timer; the ring keeps filling (it is the tap's own state).
- Relay session works like any `Session`; relay "last hello wins" replacement must dispose the old
  session's subscription ([TODO(verify)] shared with daemon-status-rpc).

## Data & persistence touchpoints

- **File logging unchanged** (path, rotation, format); the service **never reads or writes** the log
  file and never changes `logDir`/`size`/`maxFiles`.
- Ring buffer: process memory, ≤ ~8 MiB worst case, rebuilt empty on start.
- No config key added in this scope. [TODO(verify)] an optional `logging.streamBufferLines` config
  was considered and rejected (YAGNI: 1000 = protocol maximum).
- No persistence of subscriptions.

## Error handling & edge cases

| Condition | Behavior |
|-----------|----------|
| Invalid `minLevel` / `tail` | `{ok:false, error:"invalid_level"|"invalid_tail"}`; any existing subscription is left unchanged |
| `tail: 0` | No backlog; live only |
| Daemon level higher than requested | `effectiveLevel` reports it; client shows "daemon logs at <level>" |
| Burst > 200 lines/s | Excess lines dropped for that subscriber; `dropped` count delivered with the next push (D30) |
| Slow/dead client | Send failure removes the subscriber; pino path never blocks (the tap is synchronous, bounded work per line) |
| Logger injected / silent | Stream empty; subscribe still `ok:true` |
| Very long line | Truncated at tap time (`fields.truncated:true`) |
| Non-JSON chunk | Delivered as a plain info line; never throws |
| Multi-line chunk (several NDJSON lines in one write) | Split on `\n` and processed individually |
| Daemon restart | Ring empty; clients reconnect and re-subscribe |
| Old daemon (flag absent) | Client gates on flag, shows degraded banner (D26) |
| Subscriber count large | Per-subscriber cost bounded by the 200/s bucket; no global cap in this scope |
| Log line contains the dashboard's own traffic (e.g. the daemon logs "ws client connected" for the dashboard) | Delivered normally; no feedback loop because the daemon does not log log-push traffic (`debug` router logs are per RPC request only, not per push) |
| Subscribe floods | Each subscribe replaces state in O(tail) ≤ O(1000); not rate limited (consistent with other RPCs) |

## Non-functional

- **Performance (D33):** idle (no subscriber) overhead = one pino destination write + ring push per
  line; subscribed overhead bounded by the 200 lines/s bucket and 100 ms batching. Budget
  < 1 % of one core at the stated load together with status sampling.
- **Security (D31):** no extra gate; redaction posture above; the frame/line caps bound memory.
- **Compatibility (D34):** additive; stdout/file output unchanged; old clients never see the new
  messages.
- **Rollback:** pi-studio additions are inert unless a client subscribes.

## Dependencies on other specs

- [daemon-status-rpc.md](daemon-status-rpc.md) — flag and the session-close disposal pattern.
- [../architecture/daemon-bootstrap.md](../architecture/daemon-bootstrap.md) — logger creation order
  (the tap must exist before the logger and before handler registration).
- [../architecture/auth-security.md](../architecture/auth-security.md) — D31 posture, authenticated
  handlers only.
- [../architecture/external-client-fixtures.md](../architecture/external-client-fixtures.md) — fixtures.

## Acceptance criteria

Unit tests on `LogTap`/service with fake timers and a fake clock; daemon-level tests with a
`createLogger({ tap, level, stdoutStream })`-built logger injected into `startDevDaemon` plus the
service wired to the same tap.

- [x] **Live delivery.** Given a subscriber at `minLevel:"info"`, when the daemon logs an info line,
  then a `daemon_log_lines` push containing it arrives within 1 s (≤ one 100 ms flush). (D30)
- [x] **minLevel filter.** Given a subscriber at `warn`, then info/debug lines are never delivered and
  warn/error/fatal are; re-subscribing at `info` starts delivering info lines. (D30)
- [x] **Level clamp.** Given a daemon at level `info` and a subscribe at `debug`, then the response
  has `effectiveLevel:"info"` and no debug lines are ever delivered. (D30)
- [x] **Tail backlog.** Given 1500 lines logged before subscribing with `tail:1000`, then the response
  `lines` has exactly 1000 entries, oldest first, being the most recent 1000; with `tail:200,
  minLevel:"warn"` it has up to 200 warn+ lines drawn from the ring; `tail:1001` → `invalid_tail`.
  (D30)
- [x] **200 lines/s cap + dropped counter.** Given a subscriber and a burst of 1000 lines in one
  fake-clock second, then at most 200 lines are delivered in that second, and the summed `dropped`
  across pushes equals 1000 − delivered (and a trailing push with empty `lines` and `dropped > 0` is
  sent if needed). Another subscriber's delivery is unaffected by the first's drops. (D30)
- [x] **Per-session lifecycle.** After unsubscribe or socket close, no more pushes are sent to that
  session and its flush timer is cleared; a different session's subscription is unaffected; with
  zero subscribers no flush timer is pending. (D30, D33)
- [x] **File/stdout unchanged.** With and without a tap, the stdout stream and the rotating file
  receive identical bytes for the same log calls. (D4)
- [x] **Line cap.** A log call with a 100 KB string field yields a delivered line ≤ 8 KiB with
  `fields.truncated:true`; the ring never holds an oversized line. (D30)
- [x] **Non-JSON / multi-line chunks.** A raw-text chunk is delivered as an info line; a chunk with
  three NDJSON lines yields three entries. (D30)
- [x] **Redaction.** A line with `{password:"hunter2"}`, `{apiKey:"k"}` and a message containing
  `pi-studio.bearer.s3cr3t` streams as `[redacted]`/masked, while the file entry is byte-identical to
  an untapped run. A full agent + UI-request scenario's log stream contains none of its sentinel
  secret strings. (D29, D31)
- [x] **Injected/silent logger.** With `silentLogger()`, subscribe returns `ok:true`, no lines, no
  errors. (D30)
- [x] **Flag & schemas.** `daemonObservability` advertised; all three new message schemas are
  `.passthrough()` union members; fixtures parse and match live output. (D22, D26)
- [x] **Authenticated only.** Unauthenticated sockets cannot reach the handlers; authenticated ones
  need no extra role. (D31)

## Out of scope

- Reading the on-disk log file or older runs; log search/download; per-subsystem filters.
- Changing the daemon's log level at runtime for a subscriber.
- Streaming other processes' logs (agent `pi` children's stderr, the relay).
- A pino `redact` configuration for the whole daemon (would alter file output).
- Binary framing, compression, backpressure protocol beyond the cap.

## TODO(verify) — resolved (sprint-085)

- [x] `rotating-file-stream` naming — not relevant: the ring design never reads files.
- [x] pino hands multistream destinations one serialized line per `write`: verified against the
  installed pino by `log-tap.test.ts` ("receives exactly one serialised line per write from the
  installed pino"); the multi-line split rule remains the safety net.
- [x] Tap before logger: both bootstraps create the `LogTap` first (or take `opts.logTap`) and pass
  it to `createDaemonLogger` only when they build the logger; no other startup code was reordered.
  An injected logger streams nothing unless the caller passes the same tap to `createLogger({tap})`;
  a `silentLogger()` daemon answers `ok:true`, `effectiveLevel:"silent"`, no lines.
- [x] Sanitizer keys: whole-name, case-insensitive match on `password`, `passwd`, `secret`,
  `token`, `authorization`, `cookie`, `apikey`, `api_key`, `bearer`, `privatekey`, `secretkey`
  (superset of the original list, matching whole names so usage counters such as `tokens` /
  `inputTokens` are spared; asserted in `log-tap.test.ts`).
- [x] Relay replacement: a replaced relay `Session` never runs `onSessionClose`; `resetRelaySession`
  disposes the log subscription next to the status one (shared with daemon-status-rpc).
- [x] Ring memory: 1000 lines x <= 8 KiB = ~8 MiB worst case, typical ~200 KB; the combined cost run
  below held RSS at ~182 MB with 500 agents. Accepted. No `logging.streamBufferLines` key (YAGNI).

## Acceptance evidence (sprint-085)

| Criterion | Evidence |
|---|---|
| Live delivery; minLevel filter | `daemon-logs-e2e.test.ts` "delivers a live line within the flush window and honours minLevel"; `daemon-logs-service.test.ts` "filters by minLevel and re-subscribing replaces the level" |
| Level clamp | `daemon-logs-service.test.ts` "clamps to the daemon level and reports silent for an unattached tap" |
| Tail backlog | `log-tap.test.ts` "keeps the 1000 newest of 1500 lines..."; `daemon-logs-service.test.ts` "returns the tail backlog oldest first"; "rejects invalid input..."; `daemon-logs-e2e.test.ts` "returns the newest `tail` lines..." |
| 200 lines/s cap + dropped | `daemon-logs-service.test.ts` (burst cap, trailing empty push, second subscriber unaffected) |
| Per-session lifecycle | `daemon-logs-service.test.ts` "stops pushes and timers..."; `daemon-logs-e2e.test.ts` "stops pushing after unsubscribe and after the socket closes" |
| File/stdout unchanged | `log-tap.test.ts` "keeps stdout and file bytes identical with and without a tap" |
| Line cap; non-JSON/multi-line | `log-tap.test.ts` (100 KB field; wide line; raw text and split chunks) |
| Redaction | `log-tap.test.ts` "redacts sensitive keys and bearer tokens in the tap only..."; `daemon-logs-e2e.test.ts` "never streams the sentinel secrets..." |
| Injected/silent logger | `daemon-logs-e2e.test.ts` "a daemon with an injected silent logger..." |
| Flag & schemas | `client-capabilities.test.ts`, `session-messages.test.ts`, stage 2 fixtures in Layer A + B |
| Authenticated only | `daemon-logs-e2e.test.ts` "rejects an unauthenticated socket and serves an authenticated one" |

## Combined cost check (D33), sprint-085/task-006

Dev daemon, 500 mock agents, one subscriber on status (5 s push) and logs (`info`), a steady
200 lines/s of logging, 60 s of real time, CPU from `process.cpuUsage()` of the whole process
(client and load generator in-process, so an upper bound): **0.83 % of one core** (611 frames,
11 980 lines pushed). Same load with no subscriber: 0.38 %. Under the < 1 % budget; no tuning.
