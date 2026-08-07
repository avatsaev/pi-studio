# Task 003 — Resume triggers: immediate reconnect + stale-socket probe

- **Sprint:** sprint-050-connection-resilience
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (lib/connection)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001 (`reconnectNow()`)

## Goal

React to tab-visible and network-online signals: reconnect immediately when the connection is
already down, and probe with a `ping` when it merely *looks* up — catching the half-open socket left
behind by a laptop sleep or a lapsed NAT binding.

## Context / why

The web client has no client→server liveness loop. Socket `message`/`close` events are its only
inputs, so a connection killed without a close frame (sleep, NAT timeout) stays `open` in the UI
indefinitely — until some RPC happens to time out. Users see "connected", nothing streams, and
nothing recovers on its own. Separately, when the socket *did* close while the tab was hidden, the
user's return is the strongest available signal that retrying now beats waiting out the remaining
backoff rung (task-001 added `reconnectNow()` for exactly this).

Both are the same trigger surface, so they ship together.

## Scope references

- `clean-room-scope/features/connection-resilience.md` § Purpose (item 2); § Public Contract → New
  web-client modules + Action semantics + Decision table; § Behavior & Algorithms; § Why the probe
  closing the socket does NOT violate invariant 6
- `packages/web-client/src/lib/connection/resume-action.ts` — create (pure core)
- `packages/web-client/src/lib/connection/resume-action.test.ts` — create
- `packages/web-client/src/lib/connection/resume-triggers.ts` — create (DOM wiring)
- `packages/web-client/src/lib/connection/connection-store.ts` — read (live `daemon` / `reconnection`
  handles + `status`); no modification expected
- `packages/web-client/src/main.tsx` — modify (install once)

## What to build

**1. `resume-action.ts` — pure, DOM-free decision core.**

```ts
export type ResumeAction = "none" | "reconnect-now" | "probe";

export function resolveResumeAction(input: {
  status: ConnectionState;   // from @av-pi-studio/client
  managerActive: boolean;    // connection-store's `reconnection !== null`
  probeInFlight: boolean;
}): ResumeAction;
```

Decision table (implement exactly; the spec's § Public Contract carries the rationale column):

|`status`|`managerActive`|`probeInFlight`|→|
|---|---|---|---|
|`closed`|true|–|`reconnect-now`|
|`open`|true|false|`probe`|
|`open`|true|true|`none`|
|`connecting` / `closing`|–|–|`none`|
|any|false|–|`none`|
|`idle`|–|–|`none`|

> **Deviation from the spec's first draft, applied deliberately:** the spec's signature also took a
> `signal: "visible" | "online"` parameter, but no row of the table branches on it — both signals
> resolve identically. Carrying an unused discriminant into the core would be speculative
> generality, so `signal` stays at the wiring layer (where it is useful for logging and for the
> Electron `powerMonitor` source later). Update the spec's Public Contract block to match.

**2. `resume-triggers.ts` — thin DOM wiring.**

```ts
export const PROBE_TIMEOUT_MS = 5_000;
/** Subscribes to `visibilitychange` (hidden→visible only) and `online`. Returns a detach fn. */
export function attachResumeTriggers(): () => void;
```

- Reads live handles off `useConnectionStore.getState()` at signal time (never captures them at
  attach time — the store replaces `daemon`/`reconnection` on every `connect()`).
- Owns the module-local `probeInFlight` boolean; passes it into `resolveResumeAction` and clears it
  in a `finally`.
- `reconnect-now` → `reconnection.reconnectNow()`.
- `probe` → `daemon.ping(PROBE_TIMEOUT_MS)`; on rejection: re-read the store and, **only if its
  current `daemon` is still the probed instance** (identity check — the user may have disconnected
  or reconnected while the probe was pending), `daemon.close(4000, "stale-connection-probe")`.
  On resolve: nothing. **Do not call `reconnectNow()` here** — `close()` sets the client to
  `closing` synchronously, so a same-tick `reconnectNow()` always no-ops on its
  `state === "closed"` guard (task-001); it would be dead code. The reconnect happens via the
  active manager's `closed`-transition handler: rung-1 retry, ~500 ms. Comment this at the call
  site so nobody "restores" the no-op call later.
- `visibilitychange` fires on both directions — act only on `hidden → visible`.
- **Comment the invariant-6 reconciliation at the probe's call site** (spec § Why the probe closing
  the socket does NOT violate invariant 6). A future reader must not "fix" this into a violation, nor
  reject it as one: application RPC timeouts must never close the socket, but this probe exists
  solely to test transport liveness and is the one caller permitted to conclude socket death.

**3. `main.tsx` — install once.** Call `attachResumeTriggers()` at module scope, after
`createRoot(...).render(...)`. **Not** inside a React effect: `main.tsx` renders under
`<StrictMode>`, which double-invokes effects in dev and would attach two listener sets. Module scope
also matches the listener's true lifetime (the document, not any component).

## Out of scope

- A periodic ping loop while hidden (spec § Out of scope — battery cost, and the resume probe covers
  the moment that matters).
- Electron `powerMonitor` signals (desktop sprint).
- Any change to `DaemonClient.ping()` itself or to RPC timeout handling.
- Auto-connect / connection persistence — these triggers never initiate a *first* connection.

## Acceptance criteria

- [ ] `resolveResumeAction` returns exactly the table above for every row, including the
      `managerActive: false` short-circuit (an explicit user Disconnect is never resurrected).
- [ ] Becoming visible with a dropped connection calls `reconnectNow()` and nothing else.
- [ ] Becoming visible with a live-looking connection issues one `ping`; a `pong` within
      `PROBE_TIMEOUT_MS` results in no further action.
- [ ] A probe that times out closes the socket with code 4000; the manager's `closed`-transition
      rung-1 retry reconnects (verify one `connect()` follows, no explicit `reconnectNow()` on
      this path).
- [ ] Rapid visibility flapping never produces overlapping probes (single-probe guard).
- [ ] A late probe rejection arriving after the user clicked Disconnect (or reconnected to another
      daemon) is harmless — the identity check fails and nothing is closed or resurrected.
- [ ] Triggers are attached exactly once under `<StrictMode>` in dev.

## Test / verification plan

- Tests: `resume-action.test.ts` covering every decision-table row (pure, no DOM, no jsdom — matches
  the `text-viewer-state.ts` / `molecule-reload.ts` convention).
- Run: `npx vitest run packages/web-client/src/lib/connection/resume-action.test.ts` plus the full
  web-client suite.
- Build: `npm run build`; typecheck `npm run typecheck`; `npx oxlint` + `npx oxfmt` on touched files.
- The DOM wiring and probe behavior are deliberately left to live verification in task-004 — do not
  add jsdom to unit-test the listener plumbing.

## Notes

- Close code 4000 is in the WebSocket private-use range; it appears only in logs and carries no wire
  meaning.
- `PROBE_TIMEOUT_MS` (5 s) is intentionally tighter than `ping()`'s 10 s default: the daemon answers
  pings from its socket read loop, so 5 s of silence on a working link is already pathological.
- The identity check in the rejection handler (store's current `daemon` vs. the probed one) is the
  disconnect guard: `managerActive` was true at signal time, but the user can disconnect — or
  connect elsewhere, replacing the handles — before the probe rejects.
