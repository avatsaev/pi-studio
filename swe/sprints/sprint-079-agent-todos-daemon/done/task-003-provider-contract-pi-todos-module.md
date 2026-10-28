# Task 003 — Provider contract members + pure `providers/pi/todos.ts` mirror

- **Sprint:** sprint-079-agent-todos-daemon
- **Status:** done
- **Type:** feature
- **Area:** packages/server (agent/provider-contract, agent/providers/pi)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002

## Goal

Declare the provider-neutral todos channel, and build the pure Pi-side recognition module (no I/O)
that task-004 wires in.

## Context / why

Every piece of rpiv-todo knowledge stays inside the Pi adapter (D12, D14; root invariant 3). The
validator must reject a whole snapshot if any task is malformed, which is the extension's own
"skip whole" rule, so a foreign `todo` tool or schema drift shows no panel instead of a wrong one.

## Scope references

- swe/features/agent-todos.md § Provider contract, § Pi adapter: recognition, § Limits
- task-001 summary: verbatim `isTaskDetails`/`replayFromBranch` and the rpiv-todo version
- packages/server/src/agent/provider-contract.ts:21-27 (`PersistenceHandle`), :277-281
  (`onUiRequest` precedent), `AgentClient.hydrateTimeline?` (precedent for the process-less read)
- packages/server/src/agent/providers/pi/session-hydration.ts (`SessionEntry` import style)

## What to build

- `provider-contract.ts`, all optional, carrying one server-side type
  `AgentTodoList = {tasks: AgentTodo[]; truncated: boolean}`. Capping happens in the provider, so
  `truncated` has to travel with the list. This amends the spec's `AgentTodo[]` signatures; update
  its provider-contract table to match.
  - `AgentSession.onTodos?(cb: (list: AgentTodoList) => void): Unsubscribe`
  - `AgentSession.readTodos?(): AgentTodoList`
  - `AgentClient.readTodos?(handle: PersistenceHandle): AgentTodoList`
  - Each gets a doc comment in the `onUiRequest`/`hydrateTimeline` style.
- `packages/server/src/agent/agent-todos/todo-limits.ts`: a provider-neutral
  `capAgentTodos(tasks): AgentTodoList`. It applies a stable sort by id, the 200-task cap with
  `truncated`, the field caps (truncating over-long values with `…`, never rejecting) and the
  50-entry `blockedBy` cap, all from task-002's constants. The Pi module and the mock (task-005)
  both call it, so neither provider imports the other.
- `packages/server/src/agent/providers/pi/todos.ts` with a **mirrored-internals header** naming the
  rpiv-todo version and source files it mirrors, and saying it must be re-checked on an rpiv-todo or
  Pi bump. It exports:
  - `TODO_TOOL_NAME = "todo"`, `TODO_STATE_ENTRY_TYPE = "rpiv-todo-state"`
  - `isTodoDetails(value): value is TodoDetails`, a strict mirror including `nextId`
  - `toAgentTodos(details): AgentTodoList`: drops `deleted`, `metadata` and `nextId`, then calls
    `capAgentTodos`.
  - `replayTodosFromBranch(entries: SessionEntry[]): AgentTodoList`: the spec's algorithm, where
    state entries win over tool results once any exists.
  - `todoDetailsFromFrame(frame: unknown): TodoDetails | undefined`: the live recogniser (spike:
    Pi emits **two** signals). It accepts an `entry_appended` frame whose `entry` is
    `{type:"custom", customType: TODO_STATE_ENTRY_TYPE, data}` with a valid `data`, and a
    `tool_execution_end` frame with `toolName === TODO_TOOL_NAME` and valid `result.details`.
    It never inspects `parentToolCallId`: a nested `ctx.executeTool` call mutates the same session's
    list (spec § live updates).

## Out of scope

- Wiring into `PiAgentSession` (task-004); the mock (task-005)

## Acceptance criteria

- [ ] Fixture tests from task-001's captured shapes: valid create/update, `deleted` dropped, id order;
  the captured `isError:false` error frame (`details.error` set) validates and keeps the list
- [ ] `todoDetailsFromFrame`: accepts both captured frame kinds (incl. a nested one carrying
  `parentToolCallId`), rejects other tools, other custom entry types and invalid data
- [ ] Any one malformed task (or missing/non-integer `nextId`) rejects the whole snapshot (spec A5)
- [ ] Replay: state entry newer than a toolResult wins (A3); toolResult-only history replays the last
  valid one (A4); a foreign `todo` result is ignored
- [ ] 250 tasks → 200 kept + `truncated:true`; over-cap fields end in `…` (A9)
- [ ] Duplicate ids kept, stable order

## Test / verification plan

- `packages/server/src/agent/providers/pi/todos.test.ts`
- `npx vitest run packages/server/src/agent/providers/pi` and `npm run build:server`
