# Schedules & Heartbeats — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [agent-sessions.md](agent-sessions.md), [mcp-server.md](mcp-server.md),
> [cli.md](cli.md), [../architecture/persistence.md](../architecture/persistence.md)

## Purpose

Schedules are cron/interval triggers that run a prompt — either creating a new agent or sending into
an existing one. A **heartbeat** is a schedule that prompts back into the *same* agent/conversation
(for reminders/babysitting where status returns inline). Distinct from a **loop** (iterative
re-execution against acceptance criteria).

## Public Contract

### Operations (request → response)
| Operation | Message | MCP | CLI |
|-----------|---------|-----|-----|
| Create | `ScheduleCreateRequest` | `create_schedule` / `create_heartbeat` | `pi-studio schedule create` |
| List | `ScheduleListRequest` | `list_schedules` | `pi-studio schedule ls` |
| Inspect | `ScheduleInspectRequest` | `inspect_schedule` | `pi-studio schedule inspect` |
| Logs | `ScheduleLogsRequest` | `schedule_logs` | `pi-studio schedule logs` |
| Pause / Resume | `SchedulePauseRequest` / `ScheduleResumeRequest` | `pause_schedule` / `resume_schedule` | `pi-studio schedule pause/resume` |
| Delete | `ScheduleDeleteRequest` | `delete_schedule` | `pi-studio schedule delete` |
| Run once now | `ScheduleRunOnceRequest` | — | `pi-studio schedule run-once` |
| Update | `ScheduleUpdateRequest` | `update_schedule` | `pi-studio schedule update` |

### Data shape (`schedules/{id}.json`)
`{ id (8 hex), name?, prompt, cadence, target, status: active|paused|completed, createdAt,
updatedAt, nextRunAt?, lastRunAt?, pausedAt?, expiresAt?, maxRuns?, runs: ScheduleRun[] }`.
- `cadence`: `{ type:"every", everyMs }` | `{ type:"cron", expression, timezone? }` (no timezone =
  UTC; IANA timezone = local wall-clock recurrence).
- `target`: `{ type:"agent", agentId }` (heartbeat-style: into existing agent) |
  `{ type:"new-agent", config:{ provider, cwd, modeId?, model?, thinkingOptionId?, title?,
  approvalPolicy?, sandboxMode?, networkAccess?, webSearch?, extra?, systemPrompt?, mcpServers? } }`.
- `ScheduleRun`: `{ id, scheduledFor, startedAt, endedAt?, status: running|succeeded|failed,
  agentId?, output?, error? }`.

## Behavior & Algorithms

```
scheduler loop:
    for each active schedule:
        compute nextRunAt from cadence (interval or cron+timezone)
        when now >= nextRunAt:
            run = startRun(scheduledFor=nextRunAt)
            if target.new-agent: create agent with config, send prompt
            else: send prompt to target.agentId   # heartbeat
            record run.status (running→succeeded/failed), output/error, agentId
            update lastRunAt; recompute nextRunAt
            if maxRuns reached or past expiresAt: status = completed
```

- Cron parsing/next-time uses the schedule's `cron.ts`; an IANA `timezone` makes recurrence follow
  local wall-clock (DST-aware), absent timezone is UTC.
- `run-once` executes immediately without altering the regular cadence.
- Pause sets `pausedAt` + `status=paused` (no runs); resume restores `active` and recomputes
  `nextRunAt`.

## Data & Persistence
- One file per schedule: `schedules/{id}.json`. See
  [../architecture/persistence.md](../architecture/persistence.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Invalid cron expression | Reject creation/update |
| Target agent missing at run time | Run fails (`status=failed`, error recorded) |
| `maxRuns` reached | `status=completed`; no further runs |
| Past `expiresAt` | Auto-complete |
| Daemon restart | Schedules reloaded; nextRunAt recomputed; missed runs not backfilled (catch-up TBD) |
| Paused schedule | Skipped by the scheduler loop |

## Dependencies
- Internal: schedule service + store + cron, AgentManager (new-agent/heartbeat), notifications.
- External: none beyond agent providers.

## Acceptance Criteria
- [ ] A `cron` schedule with an IANA timezone fires on local wall-clock time.
- [ ] An `every` schedule fires on the interval.
- [ ] `new-agent` target creates an agent and sends the prompt; `agent` target prompts an existing agent.
- [ ] Pause stops runs; resume recomputes `nextRunAt`.
- [ ] Reaching `maxRuns`/`expiresAt` marks the schedule `completed`.
- [ ] Each execution appends a `ScheduleRun` with status/output/error.

## TODO(verify)
- [ ] Missed-run/catch-up behavior across daemon downtime.
- [ ] `create_heartbeat` vs `create_schedule` MCP parameter differences.
