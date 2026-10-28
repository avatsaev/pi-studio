# Task 005 — Mock provider todos + `#todo` dev-daemon recipes — Summary

- **Sprint:** sprints/sprint-079-agent-todos-daemon
- **Completed:** 2026-10-28
- **Status:** done

## What was implemented
- `MockAgentSession`: `onTodos`, `readTodos`, public `emitTodos(tasks)` (caps through `capAgentTodos`; stores the current list and a
  module-level `mockTodosByHandle` map keyed by `sessionId`, replaced per emit and deliberately not cleared on `close()` so the
  process-less path works after the session closed). `MockAgentClient.readTodos(handle)`. `MOCK_CAPABILITIES.supportsTodos = true`.
- `providers/mock/todo-script.ts`: pure `parseTodoScript` + recipe builders `plan | advance | done | many | blocked | literal | huge |
  clear | help`; `#todo` with no/unknown recipe answers the help text. A recipe turn emits the list, a short assistant text, then
  `turn_completed` (so the service's turn-terminal reconcile also runs against it).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/providers/mock/mock-provider.ts` | members, `#todo` dispatch, capability, client read |
| `packages/server/src/agent/providers/mock/todo-script.ts` (+ `.test.ts`) | created, 18 tests |
| `packages/server/src/agent/providers/mock/mock-provider.test.ts` | "agent todos" block, 10 tests |

## Build & test results
```
$ npx vitest run packages/server/src/agent/providers/mock → 75 passed
$ npm run build:server → success;  oxlint / oxfmt clean on changed files
```

## Acceptance criteria
- [x] Parser tests: each recipe parses; unknown/no recipe → help
- [x] `emitTodos` reaches subscribers capped; `readTodos()` returns the latest
- [x] `client.readTodos(handle)` returns the list last emitted under that handle
- [x] `#todo plan` then `#todo advance` yields two snapshots in order

## Follow-ups
- The recipes' documentation next to the `#ui` ones in `packages/server/AGENTS.md` is written at sprint close (task-009); no `#ui`
  recipe section existed there to extend, so task-009 adds one.
