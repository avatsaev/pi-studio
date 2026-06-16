# Task 004 — AgentManager lifecycle state machine + recovery — Summary

- **Sprint:** sprint-005-provider-lifecycle
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
- `agent/agent-manager.ts` — `AgentManager`, the single source of truth for agent lifecycle:
  - `ManagedAgent` = `{ record, session, parentAgentId }`; `parentAgentId` derived from
    `labels["pi-studio.parent-agent-id"]` (`PARENT_AGENT_ID_LABEL`).
  - `canTransition` enforces `initializing → idle ⇄ running`, `idle/running → error → closed`
    (closed terminal); invalid transitions throw `InvalidAgentTransitionError`.
  - `add`, `setStatus`, `attachSession`, `get`, `list` (active), `listAll`, `parentAgentId`,
    `subscribe`. Every state change **persists** the agent record and **broadcasts** `agent_update`
    to all subscribers.
  - `recover()` rehydrates persisted agents (runtime **not** auto-resumed — `session: null`), then runs
    the `onRecoverLoops` hook (loop service recovers `running` loops → `stopped`).
  - Status is **literal**: changing a child never touches the parent's `lastStatus`.
- `persistence/entity-stores.ts` — added `loadAllAgents(home)` walking `agents/{cwd}/*.json`.

## Files created / changed
| File | Change |
|------|--------|
| `agent/agent-manager.ts` | created |
| `agent/index.ts` | modified — re-exports agent-manager |
| `persistence/entity-stores.ts` | modified — added `loadAllAgents` |
| `agent/agent-manager.test.ts` | added — 5 tests |

## How it satisfies the scope
- **agent-lifecycle.md § States / § Lifecycle status semantics / § Relationship labels:** the state
  machine, literal-status rule, and parent-id label derivation are reproduced.
- **daemon-bootstrap.md § Recovery:** agents reload without auto-resume; loop recovery is delegated
  to the injected hook.

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/agent/agent-manager.test.ts
 ✓ agent-manager.test.ts (5 tests)
 Test Files  1 passed (1)      Tests  5 passed (5)
$ npx oxlint packages/server   → clean
```

## Acceptance criteria
- [x] State transitions persist and broadcast to all subscribers.
- [x] `recover()` reloads persisted agents without auto-resuming their runtimes (and runs the loop hook).
- [x] A parent's `lastStatus` is unaffected by a running child (literal status).
- [x] `parentAgentId` is derived from the parent-agent-id label.

## Follow-ups / TODO(verify)
- create/run turn flow (sprint-006) and workspace activity aggregation (sprint-008) attach to this
  manager; archive + cascade is task-005 (next).
- Persistence is injectable (`saveAgent`/`loadAllAgents`) for testing; the daemon wires the on-disk
  accessors via `home`.
