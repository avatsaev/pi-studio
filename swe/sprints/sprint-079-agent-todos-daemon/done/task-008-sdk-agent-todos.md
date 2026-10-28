# Task 008 — Client SDK: facade members + `agent-todos-state.ts` reducer

- **Sprint:** sprint-079-agent-todos-daemon
- **Status:** done
- **Type:** feature
- **Area:** packages/client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal

`PiStudioClient` exposes the family; a pure reducer applies list responses and pushes by one
stale-drop rule.

## Context / why

All network traffic goes through the SDK. `seq` restarts at 1 when the daemon restarts, so the
reducer must be resettable. The consumer (sprint-080's store) resets it on every reconnect and
refetches (A13).

## Scope references

- swe/features/agent-todos.md § SDK
- packages/client/src/pistudio-client.ts:915-918 (`onAgentUiRequest` = filtered
  `daemon.onSessionMessage`), :951-974 (`listAgentUi` + `extensionUiAvailable`), :978-987
  (`hasSkillsCapability` via `daemon.hasFeature`)
- packages/client/src/agent-ui-state.ts:1-63 (pure-module header conventions)
- packages/client/src/index.ts (barrel, one-line comment per export group)
- packages/client/src/pistudio-client.test.ts:454-510, :1028-1046 (`makeFacade({features})`,
  `fake.sent`/`fake.push`)

## What to build

- `hasAgentTodosCapability()` → `daemon.hasFeature("agentTodos")`.
- `listAgentTodos(agentId): Promise<AgentTodosSnapshot>`, using the default RPC timeout. On
  `{ok:false}` it **throws** a typed `AgentTodosError` with the open-string `code`. The return type
  is a snapshot, and the consumer treats any rejection as "keep what you have".
- `onAgentTodosUpdate(cb): Unsubscribe`, filtering through a new exported guard
  `isAgentTodosUpdate`.
- `agent-todos-state.ts`, pure with no I/O:
  - `AgentTodosState = {byAgent: Record<agentId, AgentTodosSnapshot>}`
  - `applyAgentTodosSnapshot(state, snapshot)`: last-value-wins per agent; ignores `seq <= lastSeq`;
    returns the same object when ignored, so React selectors don't re-render
  - `resetAgentTodosSeq(state)`: keeps the snapshots but makes the next one of any seq win
  - `snapshotFor(state, agentId)`
- Barrel exports and the `packages/client/AGENTS.md` facade list.

## Out of scope

- Any controller/lifecycle (lives in the web-client store, sprint-080)

## Acceptance criteria

- [ ] With the flag: `listAgentTodos` sends `agent_todos_list_request` and resolves the snapshot;
  `{ok:false, error:"not_found"}` rejects with `AgentTodosError` code `not_found`
- [ ] Without the flag: `hasAgentTodosCapability()` is false
- [ ] `onAgentTodosUpdate` fires on the push, ignores other types, and stops after unsubscribe
- [ ] Reducer: stale seq dropped; equal seq dropped; after reset a seq-1 snapshot replaces seq 7;
  agents independent (A13)

## Test / verification plan

- Extend `pistudio-client.test.ts`; new `agent-todos-state.test.ts`
- `npx vitest run packages/client` and `npm run build:client`
