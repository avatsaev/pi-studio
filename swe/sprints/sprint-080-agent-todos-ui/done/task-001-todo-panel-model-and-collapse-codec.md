# Task 001 — Pure modules: `todo-panel-model.ts` + collapse-state codec

- **Sprint:** sprint-080-agent-todos-ui
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (features/chat/todos)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-079 (task-002 wire types, task-008 SDK exports)

## Goal

Every decision the panel makes is a pure, Node-tested function, so the component stays thin.

## Context / why

web-client has no jsdom (`packages/web-client/AGENTS.md:1741-1751`). Branching logic lives in plain
`.ts` modules with `.test.ts` beside them. The collapse codec is pure for the same reason: the store
(task-002) only does I/O.

## Scope references

- swe/features/agent-todos-ui.md § Public contract (Pure helpers, Collapse state), § Behavior
  (Header, Rows, Scale), § Error handling & edge cases
- packages/web-client/src/lib/pane-layout-persistence.ts:29 (`STORAGE_KEY`, versioned-record pattern)
- packages/web-client/src/providers/kv-store.ts (`localKvStore` get/set, failure-swallowing)

## What to build

`features/chat/todos/todo-panel-model.ts`:
- `counts(tasks) → {done, total}`
- `inProgress(tasks)`: the first `in_progress` task by id, or `undefined`
- `rowText(task)`: `activeForm` for `in_progress` when present, otherwise `subject`
- `collapsedSummary(tasks)`: `rowText(inProgress)` or `undefined`
- `blockedByLabel(task)`: `"blocked by #2, #5"` only when `blockedBy` is non-empty and the status is
  not `completed`; ids missing from the list still print as `#n`
- `isExpandable(task)`: `description` or `owner` present
- `panelRows(tasks, threshold = 5)`: the ordered render list of
  `{kind:"task", task, key}` and `{kind:"completed-group", count, tasks, key}`. When more than
  `threshold` tasks are completed, they collapse into one group placed at the first completed task's
  position. Keys are built from `(id, index)` so duplicate ids are tolerated.
- `visibleTasks(tasks)`: a stable sort by id. The wire already drops `deleted`, so this is the
  defensive order guarantee the spec lists.

`features/chat/todos/todo-collapse-codec.ts` resolves the spec's persistence TODO(verify):
- A sibling record, not a field in the pane layout. That record is keyed by tab identity and pane
  restore, while this state is keyed by `agentId`, which is globally unique, so "per workspace" adds
  nothing.
- Key `pi-studio-agent-todos-ui`, shape `{version: 1, collapsed: string[]}`.
- Only collapsed agent ids are stored, since expanded is the default. The list is capped at 500,
  oldest first out, so it never grows without bound.
- `parseCollapsed(raw: string | null): Set<string>`: corrupt input, a wrong version or a non-string
  entry yields an empty set, never a throw.
- `serializeCollapsed(set): string`.

## Out of scope

- Store, I/O, React (tasks 002–003)

## Acceptance criteria

- [ ] Tests cover each helper, including: no in-progress task; duplicate ids; exactly 5 completed
  (no group) vs 6 (group at the first completed position); a dangling `blockedBy`; completed tasks
  never show the blocked label
- [ ] Codec: round trip; corrupt JSON, a wrong version or a non-string entry → empty set; the 501st
  id evicts the oldest

## Test / verification plan

- `todo-panel-model.test.ts`, `todo-collapse-codec.test.ts`
- `npx vitest run packages/web-client/src/features/chat/todos` and `npm run build:web-client`
