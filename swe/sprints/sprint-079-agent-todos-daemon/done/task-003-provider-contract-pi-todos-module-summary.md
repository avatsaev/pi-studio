# Task 003 — Provider contract members + pure `providers/pi/todos.ts` mirror — Summary

- **Sprint:** sprints/sprint-079-agent-todos-daemon
- **Completed:** 2026-10-28
- **Status:** done

## What was implemented
- `provider-contract.ts`: `AgentTodoList {tasks, truncated}`; optional `AgentSession.onTodos`/`readTodos` and
  `AgentClient.readTodos(handle)`, with doc comments.
- `agent/agent-todos/todo-limits.ts`: provider-neutral `capAgentTodos` (stable id sort, 200-task cap with `truncated`, field caps
  ending in `…` without splitting a surrogate pair, `blockedBy` cap 50, unknown fields dropped, input not mutated).
- `agent/providers/pi/todos.ts`: mirrored-internals header (rpiv-todo 2.15.0 / Pi 1.4.0), `TODO_TOOL_NAME`,
  `TODO_STATE_ENTRY_TYPE`, `isTodoDetails`, `toAgentTodos`, `replayTodosFromBranch`, and `todoDetailsFromFrame` (the live
  recogniser for both `entry_appended` and `tool_execution_end`; ignores `parentToolCallId`, per the spike).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/provider-contract.ts` | `AgentTodoList`, three optional members |
| `packages/server/src/agent/agent-todos/todo-limits.ts` (+ `.test.ts`) | created, 8 tests |
| `packages/server/src/agent/providers/pi/todos.ts` (+ `.test.ts`) | created, 18 tests (fixtures are the t001 recorded frames) |

## Build & test results
```
$ npx vitest run packages/server/src/agent/agent-todos packages/server/src/agent/providers/pi/todos.test.ts → 2 files, 26 tests passed
$ npm run build:server → success
$ npx oxlint packages/server/src/agent → clean;  npx oxfmt <changed files> → clean
```

## Acceptance criteria
- [x] Fixture tests from task-001's shapes (create/update/error, `deleted` dropped, id order)
- [x] `todoDetailsFromFrame` accepts both frame kinds incl. a nested one with `parentToolCallId`; rejects the rest
- [x] One malformed task or bad `nextId` rejects the whole snapshot
- [x] Replay: state entry beats toolResult (even a later one); toolResult-only replays last valid; foreign `todo` ignored
- [x] 250 tasks → 200 + `truncated`; over-cap fields end in `…`; duplicate ids keep order

## Follow-ups
- `SessionEntry` is not imported: `replayTodosFromBranch` takes `Iterable<unknown>` and narrows structurally, like the
  extension's own `replayFromBranch` (no coupling to Pi's entry union).
- Docs (`packages/server/AGENTS.md`, root mirror list) land in task-009 with the rest of the subsystem.
