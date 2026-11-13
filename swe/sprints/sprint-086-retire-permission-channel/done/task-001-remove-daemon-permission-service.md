# Task 001 — Remove `PermissionService` and the provider-contract permission members

- **Sprint:** sprint-086-retire-permission-channel
- **Status:** done
- **Type:** refactor
- **Area:** packages/server (agent, providers/pi, providers/mock, daemon)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** none

## Goal

The daemon stops registering and implementing a permission channel that nothing produces. The wire
schemas stay, because the protocol is append-only.

## Context / why

Nothing in production emits a permission request. `PermissionService.requestPermission` and
`cancelPending` have no non-test caller. The Pi adapter's `getPendingPermissions()` returns `[]`,
and its `respondToPermission` notifies `respond_to_permission`, a command Pi does not implement
(it is absent from Pi's `dist`). Pi gates tools through extensions (`examples/extensions/permission-gate.ts`
calls `ctx.ui.select`), and those questions already travel on `agent_ui_*`. This is the same
retirement shape as s071/t001 (rewind): remove the dead daemon surface, keep the schemas unread.

## Scope references

- swe/MAIN-SCOPE.md § 10 (tool-permission channel open question; decided: retire)
- swe/features/tool-permissions.md, swe/features/extension-ui-rpc.md (supersedes the question bridge)
- packages/server/src/agent/permissions.ts (+ `permissions.test.ts`)
- packages/server/src/agent/provider-contract.ts:139 (`PendingPermission`), :245-246
- packages/server/src/agent/providers/pi/agent.ts:410-417; providers/mock/mock-provider.ts:422-428
- packages/server/src/daemon/bootstrap.ts:40, :320, :352-353; daemon/dev-bootstrap.ts:171-172
- Tests that construct or stub the members: `agent-ui-rpc.test.ts`, `compact-handler.test.ts`,
  `session-ops.test.ts`, `slash-command-ops.test.ts`, `turn-settlement.test.ts`

## What to build

- Delete `agent/permissions.ts` and its test.
- Remove the registration from both bootstraps. `agent_permission_*`,
  `agent.permission.respond.request` and the `respond_to_permission` alias then answer
  `rpc_error unknown_message_type`, the same as any unregistered type.
- Remove `PendingPermission`, `getPendingPermissions` and `respondToPermission` from
  `AgentSession`, and their Pi and mock implementations. Update the test stubs.
- Keep every schema in `packages/protocol/src/messages.ts`, with a one-line comment marking the
  family retired and unread (rewind precedent). Do not touch any manifest mode.

## Out of scope

- MCP tools and the CLI `permit` group (task-002); docs (task-003).
- Provider modes (`plan`/`default`/`full-access`), which do not gate anything. That is a separate
  open question.

## Acceptance criteria

- [ ] `grep -rn "PermissionService\|getPendingPermissions\|respondToPermission\|cancelPending" packages/server/src`
  finds only the MCP backend, which task-002 removes.
- [ ] A dev-daemon test sending `agent.permission.respond.request` gets `rpc_error`
  `unknown_message_type`.
- [ ] The protocol schema round-trip tests for the permission messages still pass, unchanged.

## Test / verification plan

- `npx vitest run packages/server packages/protocol`; `npm run build:server` after `npm run clean`
  (signature change; avoid a stale tsbuildinfo)
