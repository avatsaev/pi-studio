# Task 006 — `AgentTodosService`: retain, dedupe, sequence, reconcile, list, sweep

- **Sprint:** sprint-079-agent-todos-daemon
- **Status:** done
- **Type:** feature
- **Area:** packages/server (agent/agent-todos)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003

## Goal

One provider-neutral service owns the per-agent snapshot, its `seq`, the broadcast, and **every**
reconcile trigger.

## Context / why

Planning-time refinement of the spec. `agent_settled` already maps to
`turn_completed|turn_failed|turn_canceled` (`event-mapper.ts:158`). `AgentSession.subscribe` is
multi-subscriber. The `compaction` stream event covers manual and automatic compaction alike. So the
service subscribes to the session's own stream on attach and reconciles on those events. This
resolves the spec's "which event marks run settled" TODO without any Pi-specific code, and replaces
the spec's adapter-side settle reconcile and its two separate compaction hooks. Fork stays an
explicit `reconcile` call (task-007), because `agent_timeline_reset` is not a stream event.

## Scope references

- swe/features/agent-todos.md § Daemon service, § Error handling & edge cases, § Non-functional
- packages/server/src/agent/agent-ui/agent-ui-service.ts:62-69 (deps shape: `broadcast`,
  `getActiveSessions`, `logger`), :91-103 (`attach`: sweep first, then optional-member guard)
- packages/server/src/agent/agent-service.ts:117-128 (`ensureTimelineSeeded`: the
  `manager.get(id)?.record` + `resolveClient(record.provider)` process-less pattern)
- packages/server/src/agent/provider-contract.ts:226 (`subscribe`)

## What to build

`packages/server/src/agent/agent-todos/agent-todos-service.ts`:

- State: `Map<agentId, {seq, list, cached, unsubscribe?}>`, in memory only.
- `attach(agentId, session)`:
  - Unsubscribe any previous session's subscriptions.
  - If the session lacks `onTodos`/`readTodos`, return. Otherwise subscribe `onTodos` → `publish`.
  - Subscribe `session.subscribe`: on `turn_completed|turn_failed|turn_canceled` or
    `compaction` with `phase: "completed"`, call `reconcile`.
  - Seed with `publish(readTodos())`.
- `publish(agentId, list)`:
  - Compare structurally against the current list. A missing entry counts as empty, so a fresh
    agent with no todos broadcasts nothing.
  - If the list is equal, do nothing: no seq bump, no broadcast.
  - Otherwise `seq + 1` and broadcast `agent_todos_update` to every active session.
- `reconcile(agentId)`: with a live session, `publish(readTodos())`; without one, drop the cached
  list.
- `list(agentId)` returns `{ok:false, error:"not_found"}` for an unknown record, otherwise a
  snapshot from one of three sources:
  - a cached or live list;
  - for a live session, `readTodos()` stored **without** broadcasting;
  - for a process-less record, `resolveClient(record.provider).readTodos?.(record.persistence)`,
    then cached, with no spawn.
  - Any throw logs a `warn` with the agentId only and returns an empty snapshot.
- `sweep(agentId)` unsubscribes and clears the list. It broadcasts an empty snapshot with `seq + 1`
  only if the list was non-empty. It **keeps the seq counter**: dropping it would restart a
  re-attached agent at `seq: 1`, which every connected client drops as stale.
- Logs never carry task text at any level.

## Out of scope

- RPC handler, bootstrap wiring, fork hook (task-007)

## Acceptance criteria

- [ ] An `onTodos` emission broadcasts with seq+1 (A1); an identical emission broadcasts nothing
  (A2); an invalid snapshot never reaches the service (covered upstream, A5)
- [ ] `turn_completed` and `compaction` `completed` events trigger a `readTodos` reconcile; other
  events do not; a turn ending with unchanged state broadcasts nothing
- [ ] Re-attach (respawn) unsubscribes the old session; the old session's emissions are ignored
- [ ] Process-less `list` calls `client.readTodos` once, then serves the cache; never calls
  `createSession` (A6)
- [ ] Unknown agent → `not_found` (A10); a throwing `readTodos` → warn + empty snapshot
- [ ] Sweep broadcasts empty with seq+1 (A8); a later attach continues from that seq, never back to 1
- [ ] A session without the optional members: no subscription, `list` answers empty

## Test / verification plan

- `agent-todos-service.test.ts` with a fake session/client (no Pi), in the style of
  `agent-ui-service.test.ts`
- `npx vitest run packages/server/src/agent/agent-todos` and `npm run build:server`
