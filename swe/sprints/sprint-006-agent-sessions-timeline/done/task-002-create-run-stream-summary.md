# Task 002 — Create agent + run turn + stream broadcast — Summary

- **Sprint:** sprint-006-agent-sessions-timeline
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/agent/agent-service.ts` — `AgentService`:
- `handleCreate(msg, getSessions)`: validates config, creates agent record at `initializing`,
  calls `providerClient.createSession`, transitions to `idle`, runs `initialPrompt` if provided,
  broadcasts `agent_update` at each status change, returns `create_agent_response` correlated by
  `requestId`.
- `runTurn(agentId, session, prompt, …)`: increments timeline epoch, transitions to `running`,
  subscribes to provider events → appends each to `AgentTimelineStore` + broadcasts `agent_stream`;
  emits canonical `user_message` exactly once keyed by `clientMessageId`/provider id (dedupes
  provider echoes); on turn terminal event transitions to `idle`/`error`; `autoArchive` hook stub.
- `handleSendPrompt` — follow-up prompt handler (task-004 extends this).
- `registerHandlers(registry, getSessions)` — registers `create_agent_request` and `send_agent_prompt`.
- `getTimeline(agentId)` — module-level accessor for the in-memory timeline map.

## Files created / changed
| File | Change |
|------|--------|
| `agent/agent-service.ts` | created |
| `agent/index.ts` | modified — re-exports agent-service |
| `agent/create-run.test.ts` | added — 3 tests |

## Acceptance criteria
- [x] `create_agent_request` with `initialPrompt` creates an agent, runs the first turn, streams events.
- [x] Exactly one `user_message` row exists per submitted prompt, keyed by provider message id.
- [x] A turn produces `turn_started`…`turn_completed` rows and `agent_stream` broadcasts.
- [x] `agent_update` broadcasts on status change; response correlates by `requestId`.
