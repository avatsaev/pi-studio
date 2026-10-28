# Task 007 — Make it live: list handler, both bootstraps, fork reconcile, dev-daemon E2E

- **Sprint:** sprint-079-agent-todos-daemon
- **Status:** done
- **Type:** feature
- **Area:** packages/server (agent/agent-todos, agent/slash-command-operations, daemon)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, task-005, task-006

## Goal

The family works over a real socket on both daemons.

## Context / why

`AgentManager.onSessionAttached` is a **single slot** (`agent-manager.ts:100`) already bound to
`agentUiService.attach`, so both bootstraps compose the two calls. The hook is throw-isolated at
`:156-166`. The dev daemon must register the family because the mock is the scripted producer.

## Scope references

- swe/features/agent-todos.md § Public contract › Wire family, § Daemon service (sweep, reconcile)
- packages/server/src/agent/agent-ui/agent-ui-rpc.ts (handler style; domain failures in the payload)
- packages/server/src/daemon/bootstrap.ts:255 (`resolveClient`), :278-297 (service before manager,
  `onSessionAttached`, `manager.subscribe` archive/delete sweep)
- packages/server/src/daemon/dev-bootstrap.ts:66-74 (`broadcast`), :86-111, :149
- packages/server/src/agent/slash-command-operations.ts:36-40 (deps), :281-312 (`handleFork`;
  reset branch :298-307)
- packages/server/src/daemon/agent-ui-e2e.test.ts (dev-daemon E2E harness: port 0,
  `silentLogger()`, teardown)

## What to build

- `agent-todos-rpc.ts`: `registerAgentTodosHandlers(registry, {service})` for
  `agent_todos_list_request`, answering `agent_todos_list_response`.
- In both bootstraps:
  - construct `AgentTodosService` before `AgentManager`;
  - make `onSessionAttached` call both services' `attach`;
  - sweep in the existing `agent_archived`/`agent_deleted` branch;
  - register the handlers.
- `SlashCommandOperations` gets an optional dep `onTimelineReset?(agentId)`. `handleFork` calls it
  in the same branch that broadcasts `agent_timeline_reset`. Both bootstraps bind it to
  `service.reconcile`.
- Nothing to add for advertisement: both the WS server (`ws/ws-server.ts:60-62`) and the relay path
  (`bootstrap.ts:824`) advertise every `SERVER_FEATURES` key, so task-002's key is enough. The E2E
  still asserts that the flag is present.
- `packages/server/src/daemon/agent-todos-e2e.test.ts` on a real dev daemon over a WS client. Record
  each of:
  - flag present;
  - a `#todo plan` prompt → an `agent_todos_update` frame with seq 1;
  - `#todo advance` → seq 2;
  - a second connection's list returns the latest snapshot;
  - archive → empty snapshot;
  - unknown agent → `not_found`.

## Out of scope

- SDK (task-008); real Pi (task-009)

## Acceptance criteria

- [ ] E2E steps above pass on the dev daemon
- [ ] Fork test (fake provider whose persistence handle changes): reconcile runs, and a changed list
  broadcasts after `agent_timeline_reset` (A7)
- [ ] Extension-UI behaviour unchanged: existing `agent-ui-*` tests pass untouched
- [ ] `packages/server/AGENTS.md` subsystem section for agent todos (service, triggers, sweep, both
  bootstraps)

## Test / verification plan

- `npx vitest run packages/server` and `npm run build:server`
