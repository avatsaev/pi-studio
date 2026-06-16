# Task 003 — Schedules & heartbeats (cron/interval) — Summary

- **Sprint:** sprint-010-orchestration
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/orchestration/`:
- **`cron.ts`** — `parseCron`/`assertValidCron` (5-field `min hour dom month dow` with `*`, lists,
  ranges, steps; classic dom/dow OR semantics), `nextCronTime(expr, after, timezone?)` (minute-step
  search; IANA timezone via `Intl.DateTimeFormat` wall-clock → DST-aware; default UTC),
  `nextEveryTime(everyMs, from)`.
- **`schedule-service.ts`** — `ScheduleService` over per-schedule `schedules/{id}.json`:
  - **Ops:** `create` (validates cron, computes initial `nextRunAt`), `list`, `inspect`, `logs`,
    `pause`/`resume` (manages `pausedAt`/`status`, recomputes `nextRunAt`), `update`, `delete`,
    `runOnce` (fires immediately, cadence untouched).
  - **`tick(now)`** scheduler step: fires active schedules with `nextRunAt <= now`; records a
    `ScheduleRun` (running→succeeded/failed, output/error/agentId); updates `lastRunAt`; recomputes
    `nextRunAt`; completes on `maxRuns`/`expiresAt`.
  - **Targets** via injected `ScheduleExecutor`: `new-agent` → `createAndPrompt(config, prompt)`;
    `agent` (heartbeat) → `promptExisting(agentId, prompt)`.
  - Added `loadAllSchedules`/`deleteSchedule` accessors to `entity-stores.ts`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/orchestration/cron.ts` | created |
| `packages/server/src/orchestration/schedule-service.ts` | created |
| `packages/server/src/orchestration/index.ts` | modified (re-exports) |
| `packages/server/src/persistence/entity-stores.ts` | modified (`loadAllSchedules`/`deleteSchedule`) |
| `packages/server/src/orchestration/schedule-service.test.ts` | added — 10 tests (controlled clock) |

## Build & test results
```
$ npm run build:server                                                       → exit 0
$ npx vitest run packages/server/src/orchestration/schedule-service.test.ts  → 10 passed
$ npx oxlint / oxfmt --check packages/server/src/orchestration                → clean
```

## Acceptance criteria
- [x] A `cron` schedule with an IANA timezone fires on local wall-clock time (EDT & EST verified);
      `every` fires on the interval.
- [x] `new-agent` target creates an agent + sends the prompt; `agent` target prompts an existing one.
- [x] Pause stops runs; resume recomputes `nextRunAt`.
- [x] Reaching `maxRuns`/`expiresAt` marks the schedule `completed`.
- [x] Each execution appends a `ScheduleRun` with status/output/error (+ persists across reload).

## Follow-ups / TODO(verify)
- Missed-run/catch-up across downtime (current: recompute forward, no backfill).
- `create_heartbeat` vs `create_schedule` MCP param differences. Real scheduler-loop timer wiring +
  MCP/CLI handlers ride bootstrap / sprint-011 (`tick` is driven directly here).
