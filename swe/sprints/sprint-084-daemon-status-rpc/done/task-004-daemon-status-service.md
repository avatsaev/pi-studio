# Task 004 — `DaemonStatusService`: sampling, snapshot, shared 5 s timer, subscribers

- **Sprint:** sprint-084-daemon-status-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/server (observability)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002, task-003

## Goal

A pure-ish service builds `DaemonStatus` snapshots and pushes one shared snapshot per tick to
subscribed sessions. It does zero work when nobody subscribes.

## Scope references

- swe/features/daemon-status-rpc.md § Behavior & algorithms (field sources table,
  `DaemonStatusService` pseudo-code), § Error handling, § Non-functional (cost D33)
- packages/server/src/agent/agent-manager.ts:221 (`list()` excludes archived, which resolves the
  spec TODO)
- packages/server/src/ws/session.ts (task-003 metadata)

## What to build

- `packages/server/src/observability/daemon-status-service.ts`, constructed with injected deps:
  - `listAgents()`, `getActiveSessions()`;
  - a `sampler` (`cpuUsage`, `memoryUsage`, `monitorEventLoopDelay` factory, `now` monotonic,
    `wallNow`);
  - a `send(session, message)` wrapper.
  Methods:
  - `snapshot()`;
  - `oneShot()`: starts sampling if not already running, builds a snapshot, then stops sampling
    again if nobody subscribes;
  - `subscribe(session)`: idempotent, fresh snapshot each time, `{ok, intervalMs: 5000, status}`;
  - `unsubscribe(session)`; `disposeSession(session)`.
  - Internals: `tick()`, `stopSampling()`, with an `unref()`ed timer.
- Rules:
  - `cpuPercent` is the delta formula, `0` on the first sample;
  - lag is the histogram mean ns→ms, NaN→0, reset after each read;
  - `agentsByStatus` holds only non-zero keys;
  - `clients` is ordered by `connectedAt`, then `clientId`, and includes the requester;
  - `startedAt` and its monotonic baseline are captured at construction (bootstrap start; spec
    TODO).
- A send failure drops only that subscriber. Subscribe and unsubscribe are logged at `debug` only.

## Acceptance criteria

- [ ] With fake timers, subscriber A receives exactly 3 updates after 15 s, and non-subscriber B
  receives none.
- [ ] After the last unsubscribe or dispose, there is no pending timer and the histogram is
  disabled. Before any subscribe, none exists.
- [ ] With N subscribers, one tick calls `cpuUsage` and `memoryUsage` once each and sends N frames.
- [ ] The injected CPU delta produces the documented percent. First sample = 0, lag NaN = 0.
- [ ] Cost budget: 10 subscribers and 500 agents over 60 s of fake-clock ticks, with measured
  sampling and serialisation time below 1 % of one core (D33). Report the number.

## Test / verification plan

- `npx vitest run packages/server/src/observability`; `npm run build:server`

## Notes

- `clients[]` cap (spec TODO): no cap in this task. Record it as an open question unless the
  engineer decides otherwise.
