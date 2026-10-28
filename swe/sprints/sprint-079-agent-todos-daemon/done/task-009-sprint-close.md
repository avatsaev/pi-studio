# Task 009 — Sprint close: SDK E2E, real-Pi live E2E, docs, full gates

- **Sprint:** sprint-079-agent-todos-daemon
- **Status:** done
- **Type:** test + docs
- **Area:** repo-wide
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006, task-007, task-008

## Goal

Prove the family end to end through the SDK and against a real `pi --mode rpc` with rpiv-todo, then
land the docs.

## Context / why

Every earlier task used fixtures or the mock. The contract that matters is agreement with real Pi
and real rpiv-todo traffic. Sprint-080 builds on this sprint with no daemon changes of its own.

## Scope references

- swe/features/agent-todos.md § Acceptance criteria (A1–A13), § TODO(verify)
- packages/cli/src/agent-ui-sdk-e2e.test.ts (the only package depending on both client and server;
  `startDevDaemon` is already exported from `packages/server/src/daemon/index.ts`)
- swe/sprints/sprint-066-extension-ui-rpc/done/task-006-e2e-real-pi-and-docs.md (disposable `core`
  pack + `PI_STUDIO_PI_HOME` recipe)
- Root AGENTS.md § Pi dependency posture ("Three places deliberately mirror Pi internals"),
  § Protocol overview

## What to build

1. `packages/cli/src/agent-todos-sdk-e2e.test.ts` against a real dev daemon:
   - `#todo plan`/`advance` through `onAgentTodosUpdate` + reducer;
   - late joiner via `listAgentTodos`;
   - daemon stop and restart on the same port: after `resetAgentTodosSeq` on reconnect, the new
     daemon's `seq: 1` snapshot is applied, not dropped.
2. Real-Pi live E2E (production daemon, disposable homes, `core` pack, real model). Record each step
   with its observed result, or not-run with the reason:
   - (a) the `agentTodos` flag is advertised;
   - (b) a model-driven `todo` call produces an `agent_todos_update` frame;
   - (c) a second call increments seq;
   - (d) a turn ending with no todo change broadcasts nothing;
   - (e) `/compact` completes with a reconciled, unchanged list and no broadcast;
   - (f) a fork to before the todos broadcasts the forked branch's list;
   - (g) a daemon restart, then `agent_todos_list_request`, returns the list from the file with no
     `pi` process spawned (check the process list);
   - (h) archive broadcasts an empty snapshot;
   - (i) logs at `debug` contain no task text.
3. Docs:
   - Root `AGENTS.md`:
     - add an `agent_todos_*` protocol bullet: real union members, `agentTodos` flag, broadcast to
       every session with no subscribe RPC, `seq` per daemon process, and that sprint-080 is the
       consumer;
     - change "Three places" to four, adding `agent/providers/pi/todos.ts` and noting that it is
       re-checked on an **rpiv-todo** bump as well as a Pi bump.
   - `packages/protocol`, `packages/server` and `packages/client` `AGENTS.md`: verify the entries
     earlier tasks added.
   - `swe/features/agent-todos.md`:
     - status: planned → shipped;
     - TODO(verify) resolved;
     - the amendments in place: provider-contract `AgentTodoList`, and service-owned reconcile
       triggers replacing the adapter-side settle hook;
     - paths corrected to `packages/server/src/agent/providers/...`.
   - `swe/MAIN-SCOPE.md` § 10 agent-todos item updated.
   - PLAN.md sprint-079 status.

## Out of scope

- Any web-client code

## Acceptance criteria

- [ ] SDK E2E passes, including the restart/reset case
- [ ] Every live step recorded with its observed result
- [ ] Docs updated as listed; no contradicted invariant left in place
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` green

## Test / verification plan

- `npx vitest run packages/cli/src/agent-todos-sdk-e2e.test.ts`
- The live steps above
- Full gates
