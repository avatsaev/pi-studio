# Task 005 — Cross-host Sessions & Schedules screens + Command center — Summary

- **Sprint:** sprint-013-app-navigation-screens
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Implemented global cross-host Sessions aggregation, Schedules aggregation/row resolution/form request
model, legacy Sessions redirect, and the Command Center search/ranking/navigation/focus-restore model.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/screens/cross-host.ts` | created cross-host sessions/schedules aggregation, schedule bucket and target resolution, form request round-trip |
| `packages/app/src/screens/command-center.ts` | created command center static actions, agent ranking/search, keyboard reducer, activation route, focus restore registry |
| `packages/app/src/screens/cross-host-command-center.test.ts` | added 19 tests |
| `packages/app/src/screens/index.ts` | exports cross-host + command-center modules |

## How it satisfies the scope

- `/sessions` is modeled as global/cross-host by default: aggregates rows across N hosts, host-filter
  support, origin-host column when all hosts are shown, loading/error/empty/list states, last-activity sort.
- Legacy `/h/[serverId]/sessions` compatibility path maps to `/sessions`.
- `/schedules` aggregates every host's schedules, filters active/ended, shows host filter when many hosts
  are connected, and round-trips cadence/target/prompt/maxRuns/expiresAt form values.
- Schedule target resolution is gated per-host: missing target while that host's agent directory is still
  loading yields `targetState:"loading"`, not `"gone"`.
- Command Center searches agents by title/cwd, ranks pending permission → attention → running/queued →
  recency, appends static actions (New agent/Home/Settings), supports arrow wrap/close, activates routes,
  and restores previously focused elements.

## Build & test results

```
$ npx vitest run packages/app/src/screens/cross-host-command-center.test.ts
 ✓ packages/app/src/screens/cross-host-command-center.test.ts (19 tests) 8ms

$ npm --workspace @av-pi-studio/app run typecheck
 success
```

## Acceptance criteria

- [x] `/sessions` and `/schedules` aggregate correctly with zero, one, and many connected hosts.
- [x] Legacy `/h/[serverId]/sessions` redirects to `/sessions`.
- [x] Schedule create/edit form values round-trip cadence/target/prompt/maxRuns/expiresAt.
- [x] Missing target on still-loading host is not prematurely shown as target gone.
- [x] Command center lists/searches/ranks agents, activates selection, and restores focus.

## Follow-ups / TODO(verify)

- Actual schedule RPC calls are daemon/client integration work; this task provides client-side screen
  models and request values.
- Pull-to-refresh/load-more rendering is deferred to the RN screen runtime.
