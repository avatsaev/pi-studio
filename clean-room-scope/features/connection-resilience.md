# Connection Resilience — Background-Tab Reconnect & Stale-Socket Detection

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md) § Connection,
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md) § Ping/pong,
> [desktop-app.md](desktop-app.md) § Local vs. remote daemon mode (the Electron shell inherits and
> supersedes parts of this feature — see § Relationship to the desktop shell)

## Purpose

The web client's connection layer degrades badly in two real-world situations that its own users
hit constantly, because *monitoring long-running agents while doing something else* is the app's
core usage pattern:

1. **Background-tab timer throttling.** All reconnect scheduling and timeout enforcement rides on
   `setTimeout`. Browsers clamp hidden-tab timers (Chrome intensive throttling: chained timers fire
   at most once per minute after ~5 minutes hidden). A Wi-Fi blip while the tab is hidden turns the
   designed 500 ms first retry into up to a minute of dead air, and every subsequent backoff rung
   rounds up to the next minute boundary. The user returns to a tab that has been silently
   disconnected for minutes when the daemon was reachable again within seconds.
2. **Half-open sockets after sleep/network change.** When a laptop sleeps or NAT state expires, no
   TCP close frame ever arrives. Socket `message`/`close` events are the *only* liveness inputs the
   client has (there is no periodic client→server ping loop anywhere in the web client), so a dead
   connection can look `open` indefinitely — until some RPC happens to time out. The user opens
   their laptop, the toolbar says connected, and nothing streams.

This feature fixes both **in the web client**, using the timer-injection seam `ReconnectionManager`
already exposes plus event-driven resume triggers. No protocol change, no daemon change.

## Current implementation (for context)

- `packages/client/src/reconnect.ts` — `ReconnectionManager`: exponential backoff (defaults
  500 ms → 30 s cap, factor 2, ±20 % jitter, unlimited attempts). Constructor accepts injected
  `setTimer`/`clearTimer`/`random` (built for tests — this is the seam this feature rides).
  Reacts to `DaemonClient` state transitions: `closed` → schedule retry; `open` → reset attempt
  counter. No public method to trigger an immediate attempt; `scheduleReconnect` is private.
- `packages/client/src/daemon-client.ts` — `ping(timeoutMs = 10_000)`: JSON `ping`/`pong` (RFC 6455
  ping is inaccessible to browsers), correlated by `requestId`, one-shot, caller-driven. `close()`
  sets `closing`, closes the transport, and the transport close event lands the client in `closed`
  — so calling `close()` while a `ReconnectionManager` is active hands off cleanly to the backoff
  machinery. RPC and ping timeouts use raw `setTimeout` (no injection seam — out of scope here,
  see § Out of scope).
- `packages/web-client/src/lib/connection/connection-store.ts` — the single construction site:
  builds `DaemonClient` + `PiStudioClient` + `ReconnectionManager` per `connect()`, wires state →
  Zustand `status`, calls `reconnection.start()` after the first successful handshake. `disconnect()`
  (explicit user action) stops the manager and nulls all handles — the anchor that distinguishes
  "user left" from "connection dropped."
- Server side: the daemon may send keepalive pings; the client answers pongs inside the `message`
  handler (not timer-driven, therefore not throttled). Client→server liveness has no equivalent.

## Public Contract

### SDK addition (`packages/client`, additive only)

```ts
class ReconnectionManager {
  /**
   * Cancel any pending backoff timer, reset the attempt counter, and attempt a reconnect
   * immediately. No-op when the manager is not active (never started, or stopped) or when a
   * reconnect attempt is already in flight. Safe to call regardless of connection state; if the
   * daemon is currently `open` it is also a no-op.
   */
  reconnectNow(): void;
}
```

Rationale for resetting the attempt counter: `reconnectNow()` only fires on a fresh external signal
(tab became visible, OS reports network back). That signal invalidates the pessimism the ladder had
accumulated; if the attempt still fails, the ladder restarts from rung 1 (500 ms), which is the
correct level of aggression for a user who is now looking at the screen.

### New web-client modules

```ts
// lib/connection/worker-timers.ts
/**
 * setTimeout/clearTimeout equivalents backed by a dedicated Web Worker (worker timers are exempt
 * from page-visibility throttling). The Worker is built from an inline Blob URL — no separate
 * asset, no bundler config. Falls back to plain setTimeout/clearTimeout when Worker construction
 * throws (e.g. a CSP without `worker-src blob:`) — degraded to today's behavior, never worse.
 * One lazily-created module-level Worker; entries correlated by numeric id.
 */
export function createWorkerTimers(): {
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};
```

```ts
// lib/connection/resume-action.ts
/** Pure decision core — DOM-free, unit-testable (this repo has no jsdom; matches the
 *  text-viewer-state.ts / molecule-reload.ts extraction convention). */
export type ResumeAction = "none" | "reconnect-now" | "probe";
export function resolveResumeAction(input: {
  status: ConnectionState;        // from connection-store
  managerActive: boolean;         // reconnection !== null
  probeInFlight: boolean;
}): ResumeAction;
```

> The resume *signal* (`"visible"` / `"online"`, and later Electron's `powerMonitor`) is
> deliberately **not** a parameter: no row of the decision table below branches on it, so carrying
> it into the core would be an unused discriminant. It stays at the wiring layer, where it is
> useful for logging and as the extension point for additional sources.

```ts
// lib/connection/resume-triggers.ts
export const PROBE_TIMEOUT_MS = 5_000;

/** Thin DOM wiring: subscribes to `visibilitychange` (hidden → visible only) and `online`,
 *  feeds resolveResumeAction, executes the action against the store's live handles (read at
 *  signal time, never captured — the store replaces them on every connect()). Returns a detach
 *  function. Installed once at module scope in main.tsx, outside React: that file renders under
 *  <StrictMode>, whose dev-mode double-invoked effects would attach two listener sets. */
export function attachResumeTriggers(): () => void;
```

Action semantics:

| Action | Executed as |
|---|---|
| `reconnect-now` | `reconnection.reconnectNow()` |
| `probe` | `daemon.ping(PROBE_TIMEOUT_MS)`; on rejection → `daemon.close(4000, "stale-connection-probe")` (the `closed` transition hands off to the active manager; then `reconnectNow()` for immediacy) |
| `none` | nothing |

Constants: `PROBE_TIMEOUT_MS = 5_000` (deliberately shorter than `ping()`'s 10 s default — a probe
fired on resume should resolve fast or be presumed dead; the daemon answers pings from its message
loop, so 5 s of silence on a working link is already pathological).

### Decision table (`resolveResumeAction`)

| `status` | manager active | probe in flight | → action | why |
|---|---|---|---|---|
| `closed` | yes | – | `reconnect-now` | user/network signal says try again immediately |
| `open` | yes | no | `probe` | connection *looks* healthy; verify it survived the sleep |
| `open` | yes | yes | `none` | single-probe guard (rapid visibility flapping) |
| `connecting` / `closing` | – | – | `none` | a transition is already in progress |
| any | no (`reconnection === null`) | – | `none` | user explicitly disconnected — never resurrect |
| `idle` | – | – | `none` | never connected in this session |

## Behavior & Algorithms

```
app mount:
    detach = attachResumeTriggers()          # once, next to other global listeners

connection-store.connect():
    timers = createWorkerTimers()             # per-module singleton is fine; created lazily
    reconnection = new ReconnectionManager(daemon, {
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    })
    ... (rest unchanged)

on visibilitychange → document.visibilityState == "visible":
on window "online":
    action = resolveResumeAction({status, managerActive, probeInFlight})
    if action == "reconnect-now": reconnection.reconnectNow()
    if action == "probe":
        probeInFlight = true
        daemon.ping(5000)
            .catch(() => { daemon.close(4000, "stale-connection-probe"); reconnection.reconnectNow() })
            .finally(() => probeInFlight = false)

ReconnectionManager.reconnectNow():
    if not active or reconnect attempt in flight: return
    if daemon.state == "open": return
    clearTimer(pending); attempt = 0
    scheduleReconnect with delay 0            # reuses tryReconnect; failure re-enters normal ladder
```

### Why the probe closing the socket does NOT violate invariant 6

Root `AGENTS.md` invariant 6: *"`rpcTimeoutMs` ≠ socket death — an RPC timeout is an
operation-level failure; it must not close or trigger reconnect."* That invariant protects
application RPCs (whose slowness proves nothing about the transport). The resume probe is the
opposite case by construction: it is issued *only* on a resume signal, its *only* purpose is
transport liveness, and the daemon answers pings from its socket read loop — so a probe timeout is
direct evidence the transport is dead, not that an operation is slow. The probe is the one caller
allowed to conclude socket death from a timeout. Document this at the probe's call site.

## Data & Persistence

None. No storage, no protocol frames, no new config. The `4000` close code is in the private-use
WebSocket range and appears only in logs.

## Error Handling & Edge Cases

| Condition | Expected behavior |
|---|---|
| Rapid visibility flapping (alt-tab spam) | Single-probe guard: at most one probe in flight; `reconnect-now` path is idempotent (attempt-in-flight no-op) |
| Probe succeeds | Nothing observable; `probeInFlight` clears |
| Probe fails but network is genuinely down | `close` → immediate attempt fails → normal backoff ladder resumes from rung 1 |
| `online` fires while `visibilitychange` probe is in flight | `none` (guard) — the in-flight probe already decides |
| User clicks Disconnect while a probe is in flight | Store nulls `reconnection`; a late probe rejection calls `daemon.close()` on an already-closed client (no-op) and `reconnectNow()` on a stopped manager (no-op) |
| Worker construction throws (CSP) | Silent fallback to `setTimeout` — behavior identical to today, feature degrades to the resume triggers only |
| Worker + relay transport | No interaction — timers are transport-agnostic; `ping()` works identically over the relay channel |
| `reconnectNow()` racing a throttled pending timer | `clearTimer` cancels it; only one attempt runs (`tryReconnect` failure is the only re-scheduler) |
| Tab discarded entirely by the browser | Out of reach — renderer is gone; only the desktop shell fixes this |

## Relationship to the desktop shell

The Electron shell ([desktop-app.md](desktop-app.md)) sets `backgroundThrottling: false`, which
makes `worker-timers.ts` redundant there (harmless — worker timers behave identically in an
unthrottled renderer). The resume triggers remain valuable under Electron and gain a stronger
signal source: `powerMonitor` `resume`/`unlock-screen` events, which fire before the window is even
focused. Design consequence: the decision core is signal-agnostic (the signal never reaches it), so
an Electron preload can drive the same core from `powerMonitor` by calling the same wiring path.
This feature ships first and the shell inherits it.

## Dependencies

- Internal: `packages/client` (`ReconnectionManager.reconnectNow()` — additive), web-client
  `connection-store.ts` (construction-site injection), app mount point (trigger installation).
- External: none. Browser APIs only (`Worker`, `Blob`, `URL.createObjectURL`,
  `document.visibilityState`, `window online` event).

## Acceptance Criteria

- [ ] `ReconnectionManager` accepts injected timers from `connection-store` (worker-backed in
      browsers; verify via devtools that backoff retries fire on schedule in a hidden tab past the
      5-minute intensive-throttling threshold).
- [ ] `reconnectNow()` is additive: existing `reconnect.ts` tests pass unchanged; new unit tests
      cover no-op-when-stopped, no-op-when-open, no-op-when-attempt-in-flight, cancel-pending-timer,
      attempt-counter reset.
- [ ] Returning to a tab whose connection dropped while hidden reconnects immediately (sub-second
      on a healthy network), not on the next throttled backoff rung.
- [ ] After laptop sleep long enough to kill NAT state: on wake + tab focus, the stale `open`
      connection is detected by the probe within `PROBE_TIMEOUT_MS` and replaced by a live one,
      with no user action and no RPC needed to trip detection.
- [ ] An explicit user Disconnect is never resurrected by any resume signal.
- [ ] `resolveResumeAction` covers the full decision table with DOM-free unit tests (no jsdom).
- [ ] With `Worker` unavailable, the app behaves exactly as before this feature plus the resume
      triggers (manual fallback verification: stub `Worker` to throw).

## Test / verification plan

- `packages/client`: unit tests for `reconnectNow()` via the existing injected-timer/fake-daemon
  test infrastructure in the `reconnect` test suite (all listed no-op guards + the
  cancel-and-attempt path).
- `packages/web-client`: unit tests for `resolveResumeAction` (full table above) and for
  `worker-timers.ts`'s fallback branch (stub `Worker` constructor to throw; assert `setTimeout`
  path). The DOM wiring in `attachResumeTriggers` stays thin enough to leave to live verification,
  per this repo's no-jsdom convention.
- Live smoke test: (1) hide tab ≥ 6 min, kill daemon, restart it, observe reconnect latency with
  the tab still hidden (worker timers) and on refocus (`reconnect-now`); (2) sleep laptop ≥ 5 min
  on Wi-Fi, wake, focus tab, observe probe → reconnect in the network panel; (3) Disconnect
  button, then flap visibility — no reconnect.

## Out of scope

- **RPC/`ping()` internal timeout timers** (`daemon-client.ts` raw `setTimeout`) — late timeout
  *detection* in a hidden tab is cosmetic (the response either arrived via the unthrottled
  `message` event or the failure surfaces on refocus). Adding a timer seam to `DaemonClient` is
  not justified by that; revisit only if evidence appears.
- **Periodic ping while hidden** — battery cost for marginal benefit over the resume probe; the
  moment that matters is the user's return, which the probe covers.
- **Tab discarding / renderer reaping** — unfixable from inside a web page; desktop-shell territory.
- **Auto-connect / connection persistence** — separate concern (see desktop-app.md § remote-only
  mode and the host-profile discussion); this feature never initiates a *first* connection.

## TODO(verify)

- [ ] Safari/Firefox: confirm dedicated-worker timers are exempt from visibility throttling under
      battery-saver modes (Chromium confirmed; others expected but unverified).
- [x] **Resolved during sprint-050 planning:** the hosted deployment sets **no**
      `Content-Security-Policy` at all (`docker/web-client.nginx.conf.template` has no CSP header,
      and no CSP directive exists anywhere under `docker/`), so blob-URL workers are unconstrained
      there. The `setTimeout` fallback still earns its place for embedded/hardened hosts; if a CSP
      is ever added to that template it must include `worker-src blob:`.
