# Feature — Agent Todos (daemon + wire + SDK)

> **Status: shipped** in `sprint-079-agent-todos-daemon`. The spec text below reflects the shipped
> implementation, including the planning-time and spike amendments (service-owned reconcile
> triggers, `AgentTodoList`, two live signals, no `parentToolCallId` filter).

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [agent-todos-ui.md](agent-todos-ui.md) (the web-client consumer),
> [agent-providers.md](agent-providers.md) (provider contract),
> [extension-ui-rpc.md](extension-ui-rpc.md) (sibling family: broadcast + list-for-late-join,
> agent-lifetime sweeps), [preinstalled-extensions.md](preinstalled-extensions.md) (`rpiv-todo` is a
> `core`-pack member), [conversation-fork.md](conversation-fork.md) (`agent_timeline_reset`),
> [context-compaction.md](context-compaction.md), [timeline-streaming.md](timeline-streaming.md)
> (session-file hydration), [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)
> Source brief: [../grills/todo-extension-ui.md](../grills/todo-extension-ui.md). `Dnn` cites its
> decisions.

## Purpose

The daemon installs `@juicesharp/rpiv-todo` itself (`core` pack, `extensions/curated-packs.ts`). The
model uses its `todo` tool to keep a task list. In Pi's TUI that list is a live overlay above the
editor. Over `pi --mode rpc` the overlay never appears: it is registered with the **factory form** of
`setWidget` (`rpiv-todo/todo-overlay.ts`), which Pi never forwards as an `extension_ui_request`
(sprint-066/task-006). So the generic `agent_ui_*` bridge cannot carry it.

The list's **state**, however, reaches the daemon in two places. Every `todo` tool result carries the
full snapshot in `result.details`. Every state-changing call also appends a session entry
`{type:"custom", customType:"rpiv-todo-state", data: <snapshot>}`. This feature has the daemon read
that state (D1). It exposes the state as a typed, provider-neutral **todos snapshot per agent**. A new
`agent_todos_*` wire family carries it, and `PiStudioClient` consumes it.

**Out of scope here:** rendering (see [agent-todos-ui.md](agent-todos-ui.md)), CLI, editing tasks
(D4, D19).

## Public contract

### Wire family (`packages/protocol`)

All schemas are real `sessionMessageSchema` members, `.passthrough()`, with optional fields wherever
possible (root invariant 5). They are advertised by the new server feature flag
`SERVER_FEATURES.agentTodos` (D18), which has a `SERVER_FEATURE_COMPAT` entry.

```
AgentTodoStatus = "pending" | "in_progress" | "completed"        // "deleted" never sent
AgentTodo = {
  id: number,            // safe integer, unique within the snapshot
  subject: string,       // length-capped (see Limits)
  status: AgentTodoStatus,
  activeForm?: string,   // capped
  description?: string,  // capped
  owner?: string,        // capped
  blockedBy?: number[],  // ids; may reference ids not present (see edge cases)
}
AgentTodosSnapshot = {
  agentId: string,
  seq: number,           // per-agent, strictly increasing within one daemon process lifetime
  tasks: AgentTodo[],    // id order; empty = "no list" (panel hidden)
  truncated?: boolean,   // true when the task cap dropped tasks
}
```

| Message | Direction | Shape | Notes |
|---------|-----------|-------|-------|
| `agent_todos_list_request` | C→S | `{requestId, agentId}` | Works for live agents **and** process-less records (D16) |
| `agent_todos_list_response` | S→C | `{requestId, snapshot: AgentTodosSnapshot}` or `{requestId, ok:false, error}` | `error ∈ "not_found"` (unknown agent). Any failure to read the session degrades to an empty snapshot, never `rpc_error` |
| `agent_todos_update` | S→C broadcast | `{type:"agent_todos_update", snapshot: AgentTodosSnapshot}` | Sent to **every** active session (D15). No subscribe RPC, same as `skills_changed` / `terminals_update` |

`nextId` and `metadata` are **not** forwarded (resolves brief TODO: the client has no use for
`nextId`; `metadata` is opaque extension data).

`deleted` tasks are dropped by the daemon, because the extension treats them as tombstones.

### Limits
- At most `MAX_TODOS = 200` tasks per snapshot, kept in id order. When tasks are dropped, set
  `truncated: true`.
- Field caps (characters): `subject` 500, `activeForm` 500, `owner` 100, `description` 4 000. An
  over-long value is **truncated** with `…`, not rejected (D17).
- `blockedBy` is capped at 50 entries.

### Provider contract (`packages/server/src/agent/provider-contract.ts`)

These are new **optional** members (D14), following the `onUiRequest` precedent. They carry one
provider-neutral type, `AgentTodoList = {tasks: AgentTodo[]; truncated: boolean}`: capping happens in the
provider (through the neutral `agent/agent-todos/todo-limits.ts` `capAgentTodos`, shared by the Pi
adapter and the mock), so `truncated` has to travel with the tasks. The daemon never sees an
extension shape.

| Member | Purpose |
|--------|---------|
| `AgentSession.onTodos?(cb: (list: AgentTodoList) => void): Unsubscribe` | Live snapshots from the running session |
| `AgentSession.readTodos?(): AgentTodoList` | Reconcile: re-derive from the session's **current** native session file (re-read each call; throws on an unreadable file) |
| `AgentClient.readTodos?(handle: PersistenceHandle): AgentTodoList` | Process-less read for a record after daemon restart, mirroring `AgentClient.hydrateTimeline` |
| `AgentCapabilityFlags.supportsTodos?: boolean` | Declared in `packages/protocol/src/provider-manifest.ts` (where the other capability flags live), not in `provider-contract.ts` |

The mock provider implements all of these. It also gets a test/dev hook (`emitTodos(tasks)`) and a
prompt-driven scripted trigger on the dev daemon (like s068/t001's dialog recipes), so the full UI is
drivable without Pi (acceptance A11).

### SDK (`packages/client`, `PiStudioClient`)

| Member | Behavior |
|--------|----------|
| `hasAgentTodosCapability(): boolean` | Reads `server_info.features.agentTodos` |
| `listAgentTodos(agentId): Promise<AgentTodosSnapshot>` | Wraps the list RPC, using the default RPC timeout |
| `onAgentTodosUpdate(cb): Unsubscribe` | Raw pushes |
| `agent-todos-state.ts` pure reducer | `apply(state, snapshot)`: per-agent last-value-wins, ignores `seq ≤ lastSeq`; a `list` response is applied through the same rule |

## Behavior & algorithms

### Pi adapter: recognition (D12)

The `providers/pi/todos.ts` module has a mirrored-internals file header. It holds:
- Constants: `TODO_TOOL_NAME = "todo"`, `TODO_STATE_ENTRY_TYPE = "rpiv-todo-state"`.
- `isTodoDetails(value)`: a strict validator mirroring rpiv-todo's `state/replay.ts` `isTaskDetails`.
  It requires `tasks` to be an array where every element has a safe-integer `id`, a string `subject`,
  and `status ∈ {pending, in_progress, completed, deleted}`. The optional fields
  (`description`/`activeForm`/`owner` strings, `blockedBy` safe-integer array, `metadata` object) must
  have the right type when present. It also requires `nextId` to be a safe integer. If **any** task
  fails, the whole snapshot is rejected (the same "skip whole" rule as the extension).
- `toAgentTodos(details)`: drop `deleted`, drop `metadata` and `nextId`, sort by id, apply the
  limits.
- `replayTodosFromBranch(entries)`: the same algorithm as rpiv-todo's `replayFromBranch`.
- `todoDetailsFromFrame(frame)`: recognises the two live signals (see "live updates") and returns the
  validated details; it ignores `parentToolCallId`.

```
replayTodosFromBranch(entries):
  fromEntries = none; fromResults = none
  for e in entries (chronological, current branch):
    if e.type == "custom":
      if e.customType == TODO_STATE_ENTRY_TYPE and isTodoDetails(e.data): fromEntries = e.data
      continue
    if e.type == "message" and e.message.role == "toolResult"
       and e.message.toolName == TODO_TOOL_NAME and isTodoDetails(e.message.details):
      fromResults = e.message.details
  return toAgentTodos(fromEntries ?? fromResults ?? EMPTY)
```

Once any state entry exists, state entries take priority over tool results. That covers writes via
`ctx.executeTool` (codemode), which never land as a `toolResult`.

These constants, the validator and the replay algorithm join the AGENTS.md "deliberately mirrors
internals — re-check on bump" list. They must be re-checked on an **rpiv-todo** bump (curated-pack
version) as well as on a Pi bump.

### Pi adapter: live updates (D13)

Pi 1.4.0 puts **two** live signals on the RPC stream for a `todo` call (spike, sprint-079 t001).
`entry_appended` (documented in Pi's `docs/json.md`) fires for every state-changing call, **however
the tool was reached** — including a nested call made through `ctx.executeTool` (Pi's built-in
`codemode`), which never lands as a `toolResult`. `tool_execution_end` carries the same snapshot for
direct calls (and for non-state-changing `list`/`get`/error calls, which are unchanged state).

```
on Pi event entry_appended where entry.type == "custom"
                              and entry.customType == TODO_STATE_ENTRY_TYPE:
  if isTodoDetails(entry.data): emitTodos(toAgentTodos(entry.data))
on Pi event tool_execution_end where toolName == TODO_TOOL_NAME:
  d = event.result.details
  if isTodoDetails(d): emitTodos(toAgentTodos(d))   // error results (isError is false; details.error
                                                    // is set) carry the unchanged state, harmless
readTodos():
  file = current native session file (re-read, as agent.ts already does after fork/new_session)
  return file ? replayTodosFromBranch(SessionManager.open(file).getBranch()) : EMPTY
```

Both sources feed the same channel and the service dedupes an identical snapshot, so the pair
(`entry_appended` first, then `tool_execution_end`) yields one broadcast. Accepting both keeps a Pi
that predates `entry_appended` working through `tool_execution_end`. Run-settled reconcile
(`readTodos()`) is the service's job (see Daemon service) and remains the safety net.

**Nested calls are NOT filtered.** An event with `parentToolCallId` is a nested call
(`ctx.executeTool`) made **in the same session**; it mutates the same list, so excluding it would
hide every codemode-driven change. The spec's earlier "children are excluded" rule (D11) applies to
child **sessions** only. No core-pack extension creates child sessions (spike: unobservable), so no
marker filter exists; if a sub-agent extension later forwards a child's events on the parent stream,
the next settled reconcile replays the parent's own file and corrects any pollution.

### Daemon service (`packages/server/src/agent/agent-todos/agent-todos-service.ts`)

The service is registered in **both** bootstraps, because the dev daemon is mock-only and the mock is
the scripted producer. Its state: `Map<agentId, {seq, list, loaded, unsubscribes}>`, in memory only and
never persisted (D16). It is provider-neutral and owns **every** reconcile trigger: it subscribes to
the session's own multi-subscriber stream, so no provider needs a settle hook.

```
attach(agentId, session):                    // via AgentManager.onSessionAttached (single slot,
                                              // composed with the extension-UI bridge)
  drop the previous session's subscriptions; return if the session lacks onTodos/readTodos
  subscribe session.onTodos → publish(agentId, list, broadcast)
  subscribe session.subscribe: turn_completed | turn_failed | turn_canceled
                               | compaction(phase=completed) → reconcile(agentId)
  publish(agentId, session.readTodos())          // seed from file; the retained list is not
                                                 // cleared first, so an equal respawn is silent

publish(agentId, list, broadcast):
  if deepEqual(list, current.list): return       // dedupe; no seq bump, no broadcast
  current = {seq: current.seq + 1, list}
  if broadcast: send {type:"agent_todos_update", snapshot} to every active session

reconcile(agentId):                              // stream-driven, plus an explicit call after a fork
  live session ? publish(agentId, session.readTodos()) : drop the cache (next list re-reads)

list(agentId):
  record unknown → {ok:false, error:"not_found"}
  loaded → snapshot
  live session → publish-without-broadcast(readTodos()) → snapshot
  process-less → client.readTodos?(record.persistence) → cache → snapshot   (never createSession)
  any throw → log warn (agentId + error message, no task text), answer an empty snapshot; the
              failure is not remembered, so the next list retries

sweep(agentId):                                  // archive / delete; same call sites as agent-ui sweep
  unsubscribe; if a list existed, publish an empty one with seq+1. The seq counter is KEPT.
```

Fork is **not** a stream event (`agent_timeline_reset` is a broadcast), so `SlashCommandOperations`
gets an optional `onTimelineReset(agentId)` dep, called in `handleFork`'s reset branch right after the
broadcast; both bootstraps bind it to `service.reconcile`. (`/tree` navigation reuses it later.)

`seq` is per daemon process and starts at 1 for each agent. After a daemon restart, seq values start
again at 1. The client's reducer therefore **resets its per-agent seq on reconnect** (a new
`server_info`) and refetches with `list`, so a fresh daemon's low seq is never dropped as stale.

## Data & persistence touchpoints

- **Read only:** Pi's JSONL session file for the record's current branch (`custom` entries of
  `rpiv-todo-state`, plus `toolResult` messages of tool `todo`). This adds no Pi-Studio file and no
  agent-record field.
- `session-hydration.ts` keeps ignoring `custom` entries **for the timeline**. Todos use a separate
  replay function, not the timeline mapper.
- There is nothing to migrate. Sessions written before rpiv-todo added state entries replay from
  `toolResult` details, exactly as the extension does.

## Error handling & edge cases

| Condition | Expected behavior |
|-----------|-------------------|
| Snapshot fails validation (drift, a foreign `todo` tool, a truncated array) | Ignored; the last valid snapshot is kept; logged at `debug` with agentId and reason only |
| Another extension registers a tool named `todo` with a different shape | Fails validation, so it never shows up (D12) |
| All tasks `deleted`, or the list is cleared | Empty `tasks`, so the UI hides the panel |
| More than 200 tasks, or over-long text | Truncated per Limits, with `truncated:true` |
| Duplicate ids in a snapshot | Kept in id order with a stable sort; the UI keys rows by `(id, index)`; rendering is never rejected |
| `blockedBy` references a missing/deleted id | Forwarded as-is; the UI shows `#n` |
| Write via `ctx.executeTool` (codemode) | Seen live through `entry_appended`; the settled reconcile re-checks |
| Fork / rewind (`agent_timeline_reset`) | `reconcile` re-reads the new branch, which yields a new seq and a broadcast |
| Future `/tree` navigation | Covered by the same `agent_timeline_reset` hook (session-tree-navigation reuses it) |
| Compaction (manual or automatic) | `reconcile` after `compaction` `completed`; state survives in custom entries |
| Interrupt / abort | No change; the snapshot is agent-lifetime state (same rule as `agent_ui_*`) |
| Client disconnect | No change; another client keeps receiving updates |
| Daemon restart, agent has no process | `list` reads the session file with no spawn; there are no pushes until the agent resumes |
| Session file missing or unreadable | Empty snapshot plus a `warn` log; never `rpc_error` |
| `rpiv-todo` uninstalled or deselected mid-session | No new data arrives; the next reconcile finds the last persisted state on the branch (the extension's history is still in the file), so the list stays frozen until cleared. Accepted: it reflects the session's history |
| Provider without `supportsTodos` | The service never subscribes; `list` answers empty |
| Old daemon (no `agentTodos`) | The SDK never calls `list`; `hasAgentTodosCapability()` is false |
| Old client on a new daemon | Ignores the unknown `agent_todos_update` frame (append-only) |
| Multiple connections / relay | Every session gets the broadcast; the client filters by `agentId` |

## Non-functional

- **Performance:** a full snapshot is sent on each change, ≤ 200 tasks, deduped server-side. The
  session file is read only on attach, run-settled, compaction, reset and list, never per tool
  event.
- **Privacy:** task text may contain code or paths. It travels only on the existing authenticated
  or E2EE channels and is never logged above `debug`; even at `debug`, logs carry no task text.
- **Rollback:** nothing is persisted, so a revert just removes the frames.

## Dependencies on other specs
- [agent-todos-ui.md](agent-todos-ui.md): the only consumer of the SDK surface.
- [extension-ui-rpc.md](extension-ui-rpc.md): reuses the `onSessionAttached` hook and the
  sweep-on-archive/delete call sites.
- [conversation-fork.md](conversation-fork.md): the `agent_timeline_reset` emission point triggers
  `reconcile`.
- [context-compaction.md](context-compaction.md): the `compaction` `completed` event triggers
  `reconcile`.

## Acceptance criteria
- [x] **A1** Given a validated `todo` frame (`entry_appended` or `tool_execution_end`), then
  `agent_todos_update` is broadcast to every session with seq+1 and the mapped tasks (`deleted`
  dropped, id order). *(`todos.test.ts`, `agent-todos-service.test.ts`, `agent-todos-e2e.test.ts`;
  live: seq 1 then 2 on a real Pi turn.)*
- [x] **A2** Given an identical consecutive snapshot, then no broadcast happens and seq does not
  change. *(Pi's double announcement and an unchanged settled turn: live, 0 extra frames.)*
- [x] **A3** Given a session file whose latest state is a `rpiv-todo-state` entry newer than any
  `todo` toolResult, then `readTodos` returns the entry's state. *(`todos.test.ts`, `todos-wiring.test.ts`)*
- [x] **A4** Given a session file with only `todo` toolResults (pre-entry sessions), then
  `readTodos` returns the last valid one.
- [x] **A5** Given an invalid or foreign `todo` payload, then nothing is broadcast and the previous
  snapshot is kept.
- [x] **A6** Given a daemon restart and `agent_todos_list_request` for a process-less record, then the
  snapshot is read from the session file and no agent process is spawned. *(Live: 0 `pi` processes
  before and after the list.)*
- [x] **A7** Given a fork, or the completion of a compaction, then the list is reconciled and a
  **changed** list is broadcast (an unchanged one is not: live compaction → 0 frames; live fork back
  to before the todos → a frame after `agent_timeline_reset`).
- [x] **A8** Given archive or delete, then the agent's entry is swept and an empty snapshot is
  broadcast.
- [x] **A9** Given 250 tasks or over-cap fields, then the snapshot holds 200 tasks,
  `truncated:true`, and capped fields.
- [x] **A10** Given an unknown `agentId`, then the list answers `{ok:false, error:"not_found"}`.
- [x] **A11** Given the mock provider on the dev daemon, a scripted trigger emits todos end to end.
- [x] **A12** Given a real `pi --mode rpc` with `rpiv-todo` (2.15.0 on Pi 1.4.0), a live E2E records:
  the feature flag, a model-driven `todo` call, the update frame, a daemon restart, and the list
  restored from the file. *(sprint-079/task-009 summary has each step's observed output.)*
- [x] **A13** The SDK reducer drops `seq ≤ lastSeq` per agent, resets on reconnect, and applies list
  responses through the same rule.

## TODO(verify)
- [x] Live-verify that Pi's RPC `tool_execution_end` for `todo` carries `result.details` with
  `{tasks, nextId}`. **Verified** (Pi 1.4.0 + rpiv-todo 2.15.0): `details = {action, params, tasks,
  nextId, error?}`; `isError` is `false` even for error results (`details.error` is set and `tasks`
  is the unchanged list). `tasks` includes `deleted` tombstones. Frames: sprint-079 t001 summary.
- [x] Live-verify that `SessionManager.open(file).getBranch()` yields
  `{type:"custom", customType:"rpiv-todo-state", data}`. **Verified**: `data` has the same
  `{action, params, tasks, nextId}` shape. Direct calls leave **both** a state entry and a
  `toolResult` message with `details`; nested calls leave **only** the state entry. After `fork`, the
  new file's branch replays the forked list (and a later call appends to it). `list` and failed calls
  append no state entry.
- [x] Confirm which Pi event marks "run settled". **Resolved at planning**: the service reconciles
  on the mapped `turn_completed|turn_failed|turn_canceled` terminal (Pi `agent_settled`), plus
  `compaction` completed, plus fork. **Verified live**: `agent_settled` follows the last
  `tool_execution_end` and the final assistant `agent_end` of a turn, then the `prompt` response.
- [x] Confirm whether sub-agent tool events can appear on the parent's RPC stream. **Resolved**:
  Pi's `parentToolCallId` marks nested calls in the **same** session (codemode), which mutate the
  same list and must be accepted. Child-session sub-agents: no core-pack extension creates one
  (grep of `@99percentpeople/pi-background-tasks`, `pi-web-access`, `pi-powerline-footer`,
  `@juicesharp/rpiv-todo`), so the case is unobservable; the settled reconcile is the mitigation.
