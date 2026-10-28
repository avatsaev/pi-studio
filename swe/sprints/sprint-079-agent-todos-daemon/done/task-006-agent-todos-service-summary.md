# Task 006 — `AgentTodosService` — Summary

- **Sprint:** sprints/sprint-079-agent-todos-daemon
- **Completed:** 2026-10-28
- **Status:** done

## What was implemented
`agent/agent-todos/agent-todos-service.ts`. Deps: `broadcast`, `getActiveSessions`, `getAgent(agentId) → ManagedAgent`, `resolveClient`,
`logger`. `attach` (re-subscribes; seeds without clearing the retained list so an equal respawn is silent), `reconcile`, `list`, `sweep`.
Reconcile triggers are stream-driven (`turn_completed|failed|canceled`, `compaction` completed). `publish` dedupes with
`isDeepStrictEqual` before bumping `seq`. `list` on first access loads (live session → `readTodos`; process-less →
`client.readTodos(record.persistence)`, never `createSession`) **without broadcasting** but with the seq bump, so a non-empty list always
has `seq ≥ 1`. A failed read warns with `{agentId, err}` only and is **not** remembered (the next `list` retries). `sweep` keeps the seq
counter; it never forgets an entry (a UUID agent id is never reused, the leak is one tiny record per agent).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/agent-todos/agent-todos-service.ts` | created |
| `packages/server/src/agent/agent-todos/agent-todos-service.test.ts` | 17 tests (fake session + client) |

## Build & test results
```
$ npx vitest run packages/server/src/agent/agent-todos → 25 passed;  npm run build:server → success;  oxlint/oxfmt clean
```

## Acceptance criteria
- [x] `onTodos` emission broadcasts seq+1; identical emission broadcasts nothing; fresh agent with no todos is silent
- [x] Reconcile on the four triggers only; unchanged state broadcasts nothing; a missed write is published at turn end
- [x] Re-attach unsubscribes the old session and ignores its emissions; equal seed does not flicker
- [x] Process-less `list` reads once via the client then serves the cache; never spawns
- [x] Unknown agent → `not_found`; throwing read → warn (no task text) + empty snapshot, retried next time
- [x] Sweep: empty snapshot with seq+1; later attach continues upward; nothing when there was no list
- [x] Session without the optional members: no subscription, empty list

## Follow-ups
- `Depends on` is task-003 only: the service tests use fakes, not the mock (task-005 is only needed by task-007).
