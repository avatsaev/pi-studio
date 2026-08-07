# Task 003 — Schedules & heartbeats (cron/interval)

- **Sprint:** sprint-010-orchestration
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-004 (sprint-003, schedule store); task-002 (sprint-006, create/run)

## Goal
Implement cron/interval schedules that create a new agent or prompt an existing one, with a scheduler
loop and run history.

## Scope references
- `clean-room-scope/features/schedules-heartbeats.md` § Operations, § Data shape, § Behavior

## What to build
- `schedule-service` + store (`schedules/{id}.json`) + `cron.ts`.
- Ops (WS/MCP/CLI-mirrored): create/list/inspect/logs/pause/resume/delete/run-once/update.
- Cadence: `{ type:"every", everyMs }` or `{ type:"cron", expression, timezone? }` (no timezone =
  UTC; IANA timezone = DST-aware local wall-clock). Target: `{ type:"agent", agentId }` (heartbeat
  into existing) or `{ type:"new-agent", config:{...} }`.
- Scheduler loop: compute `nextRunAt`; on fire, start a `ScheduleRun` (running→succeeded/failed,
  record output/error/agentId); update `lastRunAt`; recompute `nextRunAt`; `maxRuns`/`expiresAt` →
  `status:completed`. `run-once` executes immediately without altering cadence. Pause/resume manage
  `pausedAt`/`status` and recompute `nextRunAt`. On daemon restart: reload, recompute, do not backfill.

## Out of scope
- Notification delivery. CLI wiring (sprint-011).

## Acceptance criteria
- [ ] A `cron` schedule with an IANA timezone fires on local wall-clock time; `every` fires on interval.
- [ ] `new-agent` target creates an agent + sends prompt; `agent` target prompts an existing agent.
- [ ] Pause stops runs; resume recomputes `nextRunAt`.
- [ ] Reaching `maxRuns`/`expiresAt` marks the schedule `completed`.
- [ ] Each execution appends a `ScheduleRun` with status/output/error.

## Test / verification plan
- Tests: `npx vitest run .../schedule-service.test.ts` — cron+tz next-time, interval, both targets,
  pause/resume, maxRuns/expiresAt completion (use fake timers).

## Notes
- Missed-run/catch-up behavior + `create_heartbeat` vs `create_schedule` param differences are TODO(verify).
