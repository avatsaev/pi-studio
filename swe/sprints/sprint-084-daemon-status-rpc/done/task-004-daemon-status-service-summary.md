# Task 004 — DaemonStatusService — Summary

- **Sprint:** sprints/sprint-084-daemon-status-rpc
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`packages/server/src/observability/daemon-status-service.ts`: `DaemonStatusService` with `snapshot()`, `oneShot()`, `subscribe()`, `unsubscribe()`, `disposeSession()`, `dispose()`; injectable `DaemonStatusSampler` (cpu/memory/histogram/monotonic+wall clocks), `listAgents` (non-archived: `AgentManager.list()` already excludes archived, resolving that TODO), `getActiveSessions`, `send(session, envelope)`. One shared snapshot + one shared envelope per tick; timer `unref()`ed; timer and histogram only while subscribed; one-shot with no subscribers reports cpu/lag 0. A throwing send drops only that subscriber. Subscribe/unsubscribe logged at `debug`. Not wired into bootstraps (task-005). `clients[]` uncapped (open question kept).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/observability/daemon-status-service.ts` | created |
| `packages/server/src/observability/daemon-status-service.test.ts` | created (10 tests) |
| `packages/server/AGENTS.md` | layout |

## Build & test results
```
$ npm run build:server -> success
$ npx vitest run packages/server/src/observability -> 10 passed
$ npx oxlint <changed> -> clean
cost budget: 0.84 ms of sampling+serialization over 60 s (10 subscribers, 500 agents) = 0.0014 % of one core
```

## Acceptance criteria
- [x] 3 updates after 15 s for subscriber A, none for B.
- [x] No timer/histogram before subscribe or after last unsubscribe/dispose.
- [x] One tick: one cpuUsage + one memoryUsage, N frames.
- [x] CPU delta formula (50 % case), first sample 0, lag NaN→0.
- [x] Cost budget measured: 0.0014 %.

## Follow-ups / TODO(verify)
- `clients[]` cap (suggested 200) undecided.
- Real-clock soak not run; budget measured with fake-timer-driven ticks and real sampler.
