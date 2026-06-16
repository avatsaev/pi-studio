# Task 001 — Host runtime controller + session context + reconnection

- **Sprint:** sprint-012-app-runtime-ui
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-002 (sprint-007, Pi-StudioClient), task-003 (sprint-007, reconnect)

## Goal
Implement the Expo app's connection layer: saved host profiles, the host runtime controller, the
session context, and reconnection.

## Scope references
- `clean-room-scope/architecture/client-app-runtime.md` § App runtime concepts, § Connection
- `clean-room-scope/MAIN-SCOPE.md` § 4 (`packages/app/src/runtime`, `contexts`)

## What to build
- `packages/app/src/`: `HostProfile` (saved client-side connection profile), `HostRuntimeController`
  (manage saved hosts, choose transport direct-ws vs relay, reconnection with backoff, per-host
  runtime state, capability rehydrate), `SessionContext` (wrap the daemon client for the active
  session), Expo Router routes (`/h/[serverId]/workspace/[workspaceId]`, `/h/[serverId]/agent/[agentId]`).
- Expose `ConnectionState`; on drop → backoff reconnect → re-handshake → rehydrate caps → resume
  timeline from cursor.

## Out of scope
- Timeline reducers/sync planner (task-002). Composer + UI (task-003). Subagents track (task-004).

## Acceptance criteria
- [ ] A saved host connects, completes hello, records `serverId`+`features`.
- [ ] On socket drop the controller backoff-reconnects and rehydrates capabilities.
- [ ] A missing feature flag surfaces an "update host" affordance (no degraded fallback).
- [ ] Relay-profile hosts complete the E2EE handshake before any app RPC (transport selection).

## Test / verification plan
- Tests: `npx vitest run packages/app/.../host-runtime.test.ts` — connect, reconnect/rehydrate,
  feature-gate affordance (mock client).

## Notes
- Reconnection backoff parameters are TODO(verify). Relay transport itself lands in sprint-018.
