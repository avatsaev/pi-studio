# Task 002 — Protocol: `daemon_status_*` schemas (flag deliberately not yet added)

- **Sprint:** sprint-084-daemon-status-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/protocol (messages)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

The seven status messages and their payload types are real `sessionMessageSchema` members.

## Context / why

**Planning-time refinement:** `ws-server.ts` and the relay path advertise **every**
`SERVER_FEATURES` key (see sprint-079/task-007). Adding `daemonObservability` here would advertise
log streaming before it exists, and the flag covers both families (D30). So the flag lands in
sprint-085/task-005, once both are registered.

## Scope references

- swe/features/daemon-status-rpc.md § Public contract › Wire messages, `DaemonStatus`,
  `DaemonClientInfo`
- packages/protocol/src/messages.ts (union, existing `.passthrough()` patterns such as
  `viewer_settings_*`)
- packages/protocol/src/session-messages.test.ts

## What to build

- `daemonClientInfoSchema` and `daemonStatusSchema` (all `.passthrough()`; `agentsByStatus` as
  `z.record(z.number())`; `transport` as `z.enum(["direct","relay"])`, or an open string if
  the repo's convention for future values says so; record the choice).
- Request/response schemas for `daemon_status_request`/`_response`,
  `daemon_status_subscribe_request`/`_response` (`{ok:true, intervalMs, status}` |
  `{ok:false, error}`), `daemon_status_unsubscribe_request`/`_response`, and the push
  `daemon_status_update {payload}`. All are union members, and inferred types are exported.

## Acceptance criteria

- [ ] Round-trip tests parse a valid instance of each message. Unknown extra fields survive (passthrough).
- [ ] `SERVER_FEATURES` is unchanged in this task, and `daemonStatusRpc` is untouched.

## Test / verification plan

- `npx vitest run packages/protocol`; `npm run build:protocol`
