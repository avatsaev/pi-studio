# Task 005 — Mock provider todos + `#todo` dev-daemon recipes

- **Sprint:** sprint-079-agent-todos-daemon
- **Status:** done
- **Type:** feature
- **Area:** packages/server (agent/providers/mock)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003

## Goal

The dev daemon (mock-only) can drive every todo state the UI must render, with no Pi and no model
(spec A11). Tests get an `emitTodos` hook.

## Context / why

Sprint-080's live verification and its U-criteria need reachable triggers for every state: grouped
completed tasks, blocked tasks, truncation, literal markdown, and clearing. s068/t001's `#ui`
recipes are the precedent: prompt-parsed, with help text, and a pure parser tested under Node.

## Scope references

- swe/features/agent-todos.md § Provider contract (mock paragraph), § Acceptance A11
- packages/server/src/agent/providers/mock/mock-provider.ts:104-112 (`emit`/`subscribe`), :146-197
  (`startUiScriptTurn`/`raiseScriptedDialog`), :325 (`emitUiRequest`: fills defaults, returns what
  it emitted), :362-380 (`compact()` events)
- packages/server/src/agent/providers/mock/ui-script.ts:132 (`HELP_TEXT`), :203 (recipe switch)

## What to build

- `MockAgentSession`:
  - `onTodos`, and `readTodos()`, which returns the session's current in-memory list.
  - Public `emitTodos(tasks)`, which caps through task-003's `capAgentTodos`, never through
    `providers/pi/todos.ts`, and returns the emitted list.
- `createMockClient().readTodos(handle)` returns the last list emitted by the session with that
  persistence handle, from a module-level map, so the process-less path is exercisable in-process.
- `capabilities.supportsTodos = true`.
- A pure `todo-script.ts` (or new cases in `ui-script.ts`, whichever keeps the parser single-purpose)
  with these recipes, each a scripted turn that emits one or more snapshots with short delays:
  - `#todo plan`: 4 tasks, the first `in_progress` with an `activeForm`
  - `#todo advance`: completes the current task, starts the next
  - `#todo done`: all completed
  - `#todo many`: 12 tasks, 7 completed (exercises grouping and scroll)
  - `#todo blocked`: `blockedBy`, including a dangling id, plus `description`/`owner`
  - `#todo literal`: subject ``**x** <b>y</b> [l](http://e)``
  - `#todo huge`: 250 tasks with over-cap fields
  - `#todo clear`: empty list
  - `#todo help`: list the recipes
- The recipes are documented next to the `#ui` ones in `packages/server/AGENTS.md`.

## Out of scope

- The service and the broadcast (task-006)

## Acceptance criteria

- [ ] Parser tests: each recipe parses; unknown recipes and `#todo` with no recipe produce help text
- [ ] `emitTodos` reaches `onTodos` subscribers capped; `readTodos()` returns the latest list
- [ ] `client.readTodos(handle)` returns the list last emitted under that handle
- [ ] `#todo plan` then `#todo advance` on one session yields two snapshots in order

## Test / verification plan

- Tests beside `mock-provider.ts` / the script module
- `npx vitest run packages/server/src/agent/providers/mock` and `npm run build:server`
