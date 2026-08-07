# Task 004 — AgentManager lifecycle state machine + recovery

- **Sprint:** sprint-005-provider-lifecycle
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-003; task-004 (sprint-003, agent store)

## Goal
Implement the `AgentManager` as the single source of truth for agent lifecycle state, with
subscriber broadcast and boot-time recovery.

## Scope references
- `clean-room-scope/architecture/agent-lifecycle.md` § States, § Lifecycle status semantics, § Relationship labels
- `clean-room-scope/architecture/daemon-bootstrap.md` § Recovery

## What to build
- `AgentManager` holding `ManagedAgent` (discriminated union over lifecycle tag) with `lastStatus`:
  `initializing`/`idle`/`running`/`error`/`closed` and transitions
  `initializing → idle ⇄ running`, `idle/running → error → closed`.
- Subscriber registry; state changes persist to the agent record AND broadcast `agent_update` to all
  subscribers.
- `recover()`: rehydrate persisted agents (runtime NOT auto-resumed; records available); loops left
  `running` recovered as `stopped` with an interruption log entry (delegated to loop service hook).
- Status stays **literal**: a parent is `idle` when its own turn is idle even if a child runs.
- `parentAgentId` surfaced from `labels["pi-studio.parent-agent-id"]`.

## Out of scope
- create/run turn flow (sprint-006). Archive cascade (task-005). Workspace activity aggregation (sprint-008).

## Acceptance criteria
- [ ] State transitions persist and broadcast to all subscribers.
- [ ] `recover()` reloads persisted agents without auto-resuming their runtimes.
- [ ] A parent's `lastStatus` is unaffected by a running child (literal status).
- [ ] `parentAgentId` is derived from the parent-agent-id label.

## Test / verification plan
- Tests: `npx vitest run .../agent-manager.test.ts` — transition broadcast/persist, recovery,
  literal-status invariant.

## Notes
- AgentManager is the hub; later sprints attach create/run/archive/timeline behaviors to it.
