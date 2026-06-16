# Task 004 — Session operations: prompt, interrupt, update, resume, import — Summary

- **Sprint:** sprint-006-agent-sessions-timeline
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/agent/session-operations.ts` — `SessionOperationsService`:
- `handleInterrupt` — calls `session.interrupt()`; normalises agent to `idle` if still `running`; also registered under legacy alias `cancel_agent`.
- `handleUpdate` — applies `modeId`/`model`/`thinkingOptionId` to the live session (optional provider methods), updates `title`/`labels`/`config` on the record, persists + broadcasts **without recreating the session**.
- `handleResume` — resolves `PersistenceHandle` from the record, calls `client.resumeSession(handle)`, attaches new session, transitions to `idle`; throws on missing handle (surfaces `rpc_error`).
- `handleImport` — calls `client.importSession`, seeds the agent record with the timeline and persistence handle, calls `manager.add` (timeline seeded before publish), attaches the session, broadcasts `agent_update` once ready.
- `MockAgentClient` extended with an `importSession` stub.

## Files created / changed
| File | Change |
|------|--------|
| `agent/session-operations.ts` | created |
| `agent/index.ts` | modified |
| `agent/providers/mock/mock-provider.ts` | modified — added `importSession` |
| `agent/session-ops.test.ts` | added — 6 tests |

## Acceptance criteria
- [x] Interrupting a running turn yields `turn_canceled` and returns the agent to `idle`.
- [x] Resuming a closed agent via its `PersistenceHandle` attaches a new session.
- [x] Importing a native session seeds the daemon timeline before publishing the agent.
- [x] Updating model/mode/features persists+broadcasts without session recreate.
- [x] A stale resume handle (no persistence) throws and surfaces `rpc_error`.
