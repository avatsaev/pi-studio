# Task 004 — Pi adapter: live todo snapshots + session-file reads

- **Sprint:** sprint-079-agent-todos-daemon
- **Status:** done
- **Type:** feature
- **Area:** packages/server (agent/providers/pi)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003

## Goal

`PiAgentSession` emits validated snapshots on every `todo` tool end and can re-derive the list from
its current session file; `PiAgentClient` can do the same for a process-less record.

## Context / why

The live path is free, since Pi already sends the full state with every `todo` result. The file read
catches writes made via `ctx.executeTool` and branch moves. Reconcile **timing** is not decided
here: task-006's service owns every trigger. This adapter only offers `readTodos()`.

## Scope references

- swe/features/agent-todos.md § Pi adapter: live updates (amended: the run-settled reconcile moves
  to the service, see task-006)
- packages/server/src/agent/providers/pi/agent.ts:189 (`sessionFile`), :199-210 (`transport.onEvent`
  raw intake, before `eventMapper.map`), :390-393 (`onUiRequest` subscriber-set pattern), :444-457
  (rebind after fork/new_session), :821-825 (`hydrateTimeline(handle)` on the client)
- packages/server/src/agent/providers/pi/session-hydration.ts:152 (`SessionManager.open(file).getBranch()`
  inside try/catch)

## What to build

- In the raw intake, `todoDetailsFromFrame(frame)` (task-003) recognises an `entry_appended`
  `rpiv-todo-state` entry or a `todo` `tool_execution_end`, and fans out `toAgentTodos(...)` to
  `onTodos` subscribers.
  - This runs **in addition to** the existing mapping; the timeline row is unchanged.
  - Both signals fire for one direct call (`entry_appended` first); the service dedupes, so the
    adapter does not.
  - No `parentToolCallId` filter: nested calls mutate the same list (spike). Say so in a comment.
- `readTodos()` replays `this.sessionFile`'s branch with `replayTodosFromBranch`. It returns
  `{tasks: []}` when there is no file. A read error **throws** so the service can log it with the
  agentId (spec: warn + empty).
- `PiAgentClient.readTodos(handle)` does the same from `handle.nativeHandle`, never spawning.
- `capabilities.supportsTodos = true`.
- Validation rejects are logged at `debug` with the reason only, never task text.

## Out of scope

- Service, seq, broadcast (task-006)

## Acceptance criteria

- [ ] Fake-transport test using the t001 frames: a `todo` `tool_execution_end` and an `entry_appended`
  each reach an `onTodos` subscriber; a nested frame (with `parentToolCallId`) is delivered; invalid
  details reach no subscriber; unsubscribe stops delivery
- [ ] `readTodos()` against a fixture JSONL (written to a temp dir) returns the replayed list; after a
  simulated rebind to a second file it reads the new file
- [ ] `client.readTodos(handle)` reads the file with no process spawned
- [ ] Mapped timeline output for the same frames is byte-identical to before (regression)

## Test / verification plan

- Extend the Pi agent tests under `packages/server/src/agent/providers/pi/`
- `npx vitest run packages/server/src/agent/providers/pi` and `npm run build:server`
