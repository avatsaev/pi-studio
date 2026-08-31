# Task 002 — `resetTimeline` + `forkTimelineSync` feature flag — Summary

- **Sprint:** sprint-071-conversation-fork-daemon
- **Completed:** 2026-08-26
- **Status:** done

## What was implemented

Added the one daemon-internal entry point a fork resync needs (`resetTimeline`) and the server
feature flag the web-client will gate its fork UI on (`forkTimelineSync`).

- `AgentTimelineStore.replaceRows(rows)`: unconditionally replaces the row set (unlike the
  constructor's `initialRows` seeding), recomputing `epoch`/`nextSeq` from the installed rows'
  maximum (or resetting to the initial `0`/`0` state when `rows` is empty).
- `agent-service.ts`'s `resetTimeline(agentId, rows)`: gets-or-creates the agent's timeline store
  and calls `replaceRows` — unlike `seedTimeline`, which is a no-op once a store exists.
- `forkTimelineSync` added to `SERVER_FEATURES` + a matching `SERVER_FEATURE_COMPAT` entry.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/agent/timeline-store.ts` | added `replaceRows(rows)` |
| `packages/server/src/agent/timeline-store.test.ts` | added `describe("replaceRows (fork resync)")`, 4 tests |
| `packages/server/src/agent/agent-service.ts` | added `resetTimeline(agentId, rows)` |
| `packages/server/src/agent/agent-service.test.ts` | created — 4 tests covering all acceptance criteria |
| `packages/protocol/src/client-capabilities.ts` | added `forkTimelineSync` to `SERVER_FEATURES` + COMPAT |
| `packages/protocol/src/client-capabilities.test.ts` | added `"forkTimelineSync"` to expected key list |

## How it satisfies the scope

Matches `swe/features/conversation-fork.md` § New daemon-internal surface / § New server feature
flag: `resetTimeline` is provider-agnostic (takes rows, installs them — deciding *whether* to reset
is task-003's job), accepts an empty array as legitimate, and both bootstraps advertise
`forkTimelineSync` automatically since they derive `server_info.features` from
`Object.values(SERVER_FEATURES)` — no bootstrap code change needed.

## Build & test results

```
$ npm run build:protocol && npm run build:server
success (tsc -b, no errors)

$ npx vitest run packages/protocol packages/server/src/agent
Test Files  36 passed (36)
     Tests  481 passed (481)

$ npx oxfmt <changed files>; npx oxlint <changed files>
clean (no diffs, zero lint errors)
```

## Acceptance criteria

- [x] `resetTimeline` replaces rows on an agent that already has a populated in-memory store
      (`agent-service.test.ts` — seeds 2 rows, `seedTimeline` re-call no-ops at 2, `resetTimeline`
      replaces down to 1).
- [x] `resetTimeline(agentId, [])` empties the store without throwing.
- [x] After a reset, the next `startEpoch()`/`append()` continues epoch/seq from the installed
      rows' maximum (verified: installed rows at epoch 2/seq 1, next append lands at epoch 3/seq 2).
- [x] `server_info.features.forkTimelineSync` is advertised by both bootstraps (both derive
      `features` from `SERVER_FEATURES`, no per-bootstrap change required).
- [x] Every `SERVER_FEATURES` key still has a COMPAT annotation (existing
      `client-capabilities.test.ts` "annotates every server feature with a COMPAT tag" test).

## Follow-ups / TODO(verify)

None — `resetTimeline` is deliberately unwired (task-003's job).
