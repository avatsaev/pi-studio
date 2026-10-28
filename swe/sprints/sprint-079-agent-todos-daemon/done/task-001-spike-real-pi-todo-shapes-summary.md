# Task 001 — Spike: real Pi + rpiv-todo shapes — Summary

- **Sprint:** sprints/sprint-079-agent-todos-daemon
- **Completed:** 2026-10-28
- **Status:** done

## What was implemented

No production code (spike). A throwaway harness drove a real `pi --mode rpc` process (Pi
**1.4.0**, the repo's `node_modules` copy) with **`@juicesharp/rpiv-todo` 2.15.0** (the version the
unpinned curated source resolves to today; installed in the operator's `~/.pi/agent/npm`, read-only
inspected) against a disposable Pi home (`/tmp/spike-079/pihome`, a copy of `~/.pi/agent`'s `npm/`,
`auth.json`, `models-store.json` and a settings file listing only rpiv-todo + the LiteLLM provider)
and the real model credential (LiteLLM, `global.anthropic.claude-sonnet-5-5`). Four runs: create/update/
error/list, a fork, a nested call through Pi's built-in `codemode` tool, and offline branch reads via
`SessionManager.open(file).getBranch()`.

## Findings (all six items)

### 1. rpiv-todo version and verbatim mirror sources (`state/replay.ts`, `tool/types.ts`, `tool/response-envelope.ts`, `todo.ts`)

`@juicesharp/rpiv-todo@2.15.0`, MIT. `state/replay.ts`:

```ts
const TASK_STATUSES: ReadonlySet<unknown> = new Set<TaskStatus>(["pending", "in_progress", "completed", "deleted"]);

const optional = (value: unknown, valid: (v: unknown) => boolean): boolean => value === undefined || valid(value);
const isString = (v: unknown): boolean => typeof v === "string";

function isTask(value: unknown): value is Task {
	if (!value || typeof value !== "object") return false;
	const t = value as Record<string, unknown>;
	return (
		Number.isSafeInteger(t.id) &&
		typeof t.subject === "string" &&
		TASK_STATUSES.has(t.status) &&
		optional(t.description, isString) &&
		optional(t.activeForm, isString) &&
		optional(t.owner, isString) &&
		optional(t.blockedBy, (v) => Array.isArray(v) && v.every((id) => Number.isSafeInteger(id))) &&
		optional(t.metadata, (v) => typeof v === "object" && v !== null)
	);
}

export function isTaskDetails(value: unknown): value is TaskDetails {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return Array.isArray(v.tasks) && v.tasks.every(isTask) && Number.isSafeInteger(v.nextId);
}

export function replayFromBranch(ctx: { sessionManager: { getBranch(): Iterable<unknown> } }): TaskState {
	let fromEntries: TaskState | undefined;
	let fromToolResults: TaskState | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		const e = entry as {
			type?: string;
			customType?: string;
			data?: unknown;
			message?: { role?: string; toolName?: string; details?: unknown };
		};
		if (e.type === "custom") {
			if (e.customType === "rpiv-todo-state" && isTaskDetails(e.data)) fromEntries = stateOf(e.data);
			continue;
		}
		if (e.type !== "message") continue;
		const msg = e.message;
		if (msg?.role !== "toolResult" || msg.toolName !== "todo") continue;
		if (!isTaskDetails(msg.details)) continue;
		fromToolResults = stateOf(msg.details);
	}
	return fromEntries ?? fromToolResults ?? { tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId };
}
```

`tool/types.ts`: `TOOL_NAME = "todo"`, `STATE_ENTRY_TYPE = "rpiv-todo-state"`,
`Task {id, subject, description?, activeForm?, status, blockedBy?, owner?, metadata?}`,
`TaskDetails {action, params, tasks, nextId, error?}`; statuses `pending|in_progress|completed|deleted`.
`todo.ts`'s `execute` calls `pi.appendEntry(STATE_ENTRY_TYPE, toolResult.details)` **only when
`changesState(op)`**; `buildToolResult` sets `details = {action, params, tasks, nextId, ...(error ? {error} : {})}`
where `tasks` is the full list **including `deleted` tombstones**.

### 2. Raw `tool_execution_end` frames for `todo` (task text is the harness's own `Alpha/Beta/Gamma`)

Create (batch):
```json
{"type":"tool_execution_end","toolCallId":"toolu_…","toolName":"todo","result":{"content":[{"type":"text","text":"Created #1: Alpha (pending)\n…"}],"details":{"action":"create","params":{"action":"create","tasks":[{"subject":"Alpha"},{"subject":"Beta"},{"subject":"Gamma"}]},"tasks":[{"id":1,"subject":"Alpha","status":"pending"},{"id":2,"subject":"Beta","status":"pending"},{"id":3,"subject":"Gamma","status":"pending"}],"nextId":4}},"isError":false,"durationMs":5}
```
Update (`tasks[0]` becomes `{"id":1,"subject":"Alpha","status":"in_progress","activeForm":"doing alpha"}`; same envelope, `action:"update"`).

Error (unknown id) — **`isError` is `false`**; `details.error` is set and `tasks` is the unchanged list:
```json
{"type":"tool_execution_end","toolName":"todo","result":{"content":[{"type":"text","text":"Error: #999 not found"}],"details":{"action":"update","params":{"action":"update","id":999,"status":"completed"},"tasks":[{"id":1,"subject":"Alpha","status":"completed","activeForm":"doing alpha"},{"id":2,"subject":"Beta","status":"pending"},{"id":3,"subject":"Gamma","status":"pending"}],"nextId":4,"error":"#999 not found"}},"isError":false,"durationMs":0}
```
`list` returns the same envelope (no `error`), changes nothing.

**New signal the spec did not know:** Pi 1.4.0 also emits `entry_appended` (documented in Pi's
`docs/json.md`) the moment the extension calls `pi.appendEntry`. It precedes `tool_execution_end` by one frame:
```json
{"type":"entry_appended","entry":{"type":"custom","customType":"rpiv-todo-state","data":{"action":"create","params":{…},"tasks":[{"id":1,"subject":"Alpha","status":"pending"},…],"nextId":4},"id":"f1ea3e44","parentId":"2984a31c","timestamp":"…"}}
```
Order for one call: `tool_execution_start → entry_appended → tool_execution_end → message_start/end (toolResult)`.
`list`/error calls emit **no** `entry_appended`. After the extension loads, `extension_ui_request {method:"setWidget", widgetKey:"rpiv-todos"}` arrives with **no `widgetLines`** (a factory widget), confirming s066's finding.

### 3. `getBranch()` entries

Confirmed. After the create → in_progress → completed → error → list sequence the branch holds three
`{type:"custom", customType:"rpiv-todo-state", data}` entries (each `data` = `{action, params, tasks, nextId}`) and five
`message` entries with `role:"toolResult", toolName:"todo"` whose `details` is the same shape (`isError:false` even for the
error call). The state entries are written for create/update only. So a direct call leaves **both**; the list/error calls leave
only the `toolResult`.

### 4. Fork

`fork` at the third user message yielded a new session file whose branch replays: state entries for create and
in_progress, i.e. `Alpha:in_progress, Beta, Gamma` — the forked list, not the parent's final one. rpiv-todo in the new
session picked it up (next `create` produced `nextId 4` and `Delta` appended; the new state entry's `tasks` were
`Alpha:in_progress, Beta, Gamma, Delta`). The new file is addressable through `get_state.sessionFile` after `fork`.

### 5. Sub-agents / nested calls

- **Nested calls (`parentToolCallId`) are same-session.** Pi's built-in `codemode` tool (`pi --tools +codemode`) ran
  `await tools.todo({...})` twice. Each nested call produced `tool_execution_start/end` with ids
  `<callerId>/1`, `<callerId>/2` and **`parentToolCallId`**, plus an `entry_appended` with the full updated list. The branch
  holds **only the state entries** (no `toolResult` for nested calls). They mutate the same list, so they must be **accepted**,
  not filtered (the spec's "exclude `parentToolCallId`" rule was based on a wrong assumption and is amended).
- **Child-session sub-agents:** `grep` of `@99percentpeople/pi-background-tasks`, `pi-web-access`, `pi-powerline-footer` and
  `@juicesharp/rpiv-todo` for `createAgentSession|subagent|childSession` found none (`pi-web-access` references
  `parentToolCallId` only for its own nested search). Unobservable in the `core` pack. Mitigation: the settled reconcile
  replays the parent's own file.

### 6. Settle ordering

Per turn: `… tool_execution_end → toolResult message → turn_end → turn_start → assistant message → turn_end → agent_end →
agent_settled → response(prompt)`. `agent_settled` (`aborted:false`) follows the last `todo` call, so a reconcile on the
mapped `turn_*` terminal sees the final file state.

## Files created / changed

| File | Change |
|------|--------|
| `swe/features/agent-todos.md` | live-updates section rewritten (two signals, no parent filter), edge-case row, TODO(verify) checked off |
| `swe/sprints/sprint-079-agent-todos-daemon/backlog/task-003-…md` | adds `todoDetailsFromFrame` and its criteria |
| `swe/sprints/sprint-079-agent-todos-daemon/backlog/task-004-…md` | wires both signals; no parent filter |

## Build & test results

No source changed, so no build/test run. Harness output is the evidence above (raw logs at `/tmp/spike-079/events*.jsonl`,
deleted with the harness).

```
$ stat -c '%y %n' ~/.pi ~/.pi/agent ~/.pi/agent/auth.json ~/.pi/agent/settings.json ~/.pi/agent/sessions ~/.pi/agent/npm | diff - mtimes-before.txt
(no output) → MTIMES_IDENTICAL
```

## Acceptance criteria

- [x] All six items recorded with observed frames/entries (text is harness fixture text)
- [x] rpiv-todo version (2.15.0) + verbatim validator/replay source captured above
- [x] Spec TODO(verify) items checked off and the spec + tasks 003/004 amended (two live signals; nested calls accepted)
- [x] Real `~/.pi` untouched (mtimes identical); harness deleted

## Follow-ups / TODO(verify)

- `entry_appended` exists in 1.4.0 but its introduction version is unknown; the daemon's documented Pi floor is 1.1.0. Task-003/004
  accept both signals, so an older Pi still works through `tool_execution_end`; task-009's live check is on 1.4.0.
- The curated pack source is unpinned (`npm:@juicesharp/rpiv-todo`). Task-003's fixtures are tagged `2.15.0`.
- `tasks` contains `deleted` tombstones; `toAgentTodos` must drop them (already in task-003).
- **Operator note:** a stray `rm -rf ~/.pi/..` was typed during cleanup; GNU `rm` refuses paths ending in `..`, and the home
  directory was verified intact immediately afterwards (`ls -la ~`). No data affected.
