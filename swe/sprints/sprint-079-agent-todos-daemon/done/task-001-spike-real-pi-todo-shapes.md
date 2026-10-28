# Task 001 — Spike: what real Pi + rpiv-todo put on the RPC stream and in the session file

- **Sprint:** sprint-079-agent-todos-daemon
- **Status:** done
- **Type:** test
- **Area:** packages/server (investigation)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Settle the spec's four live-verify questions with recorded evidence, and capture rpiv-todo's own
validator/replay source at the curated version, before task-003 mirrors it.

## Context / why

The whole Pi adapter rests on two unverified claims: that `tool_execution_end` for `todo` carries
`result.details = {tasks, nextId}` over RPC, and that `SessionManager.open(file).getBranch()` yields
`{type:"custom", customType:"rpiv-todo-state", data}`. rpiv-todo is **not** installed in this
checkout (`node_modules` and `~/.pi` hold no copy). The only prior reading of its source was a
disposable install in s066/t006. A mirror written from memory would be a guess.

## Scope references

- swe/features/agent-todos.md § TODO(verify), § Pi adapter: recognition, § Pi adapter: live updates
- swe/grills/todo-extension-ui.md § Open questions
- swe/sprints/sprint-066-extension-ui-rpc/done/task-006-e2e-real-pi-and-docs.md (+ summary): the
  disposable `core`-pack install recipe with throwaway `PI_STUDIO_HOME`/`PI_STUDIO_PI_HOME`
- packages/server/src/extensions/curated-packs.ts:43 (`npm:@juicesharp/rpiv-todo`, unpinned)
- packages/server/src/agent/providers/pi/agent.ts:199-210 (raw event intake), :444-457 (session
  file rebind after fork)
- packages/server/src/agent/providers/pi/session-hydration.ts:152 (`getBranch()` call site)

## What to build

A throwaway harness (deleted afterwards). Use a disposable Pi home with the `core` pack installed,
and a real model credential (the LiteLLM/Haiku setup used by s074's close). Record in the summary:

1. The rpiv-todo version the curated source resolves to, plus verbatim copies of `isTaskDetails` and
   `replayFromBranch` (`state/replay.ts`) and the `todo` tool's `details` construction. These become
   task-003's fixtures and mirrored-internals header.
2. A raw `tool_execution_end` frame for `todo` (`toolName`, `result.details` shape, `isError`), for
   one create, one update, one error result.
3. The `getBranch()` entries after those calls: confirm `rpiv-todo-state` custom entries and their
   `data`, and whether a `toolResult` message carries the same `details`.
4. After a `fork`, the new session file's branch: does replay yield the forked branch's list?
5. Sub-agents: if any `core`-pack extension runs a child session, do its tool events reach the
   parent's RPC stream, and with what marker (`parentToolCallId` or another field)? If no sub-agent
   path exists in the pack, record "unobservable" with evidence.
6. Confirm `agent_settled` follows the last `todo` call of a turn (the service's reconcile trigger,
   via the mapped `turn_*` terminal).

Write each answer into `swe/features/agent-todos.md` § TODO(verify), checking items off. If any
answer contradicts the spec, amend the affected spec section and tasks 003–006 before closing.

## Out of scope

- Production code

## Acceptance criteria

- [ ] All six items recorded with the observed frames or entries (task text redacted to fixtures)
- [ ] rpiv-todo version + verbatim validator/replay source captured in the summary
- [ ] Spec TODO(verify) items checked off, or the spec and downstream tasks amended
- [ ] Real `~/.pi` untouched (mtimes compared before/after); harness deleted

## Test / verification plan

- The harness output, captured in the summary

## Notes

- `parentToolCallId` has zero occurrences in the repo today; item 5 decides whether task-004 needs a
  filter at all.
