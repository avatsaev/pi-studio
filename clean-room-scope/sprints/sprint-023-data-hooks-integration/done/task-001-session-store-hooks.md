# Task 001 — Session store & React Query hooks

- **Sprint:** sprint-023-data-hooks-integration
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** sprint-022, sprint-007 (client SDK)

## Goal
Build the Zustand session store and React Query hooks that bridge the daemon WebSocket client to
the UI layer. This is the central data backbone: agent lifecycle, stream items, permissions,
workspace descriptors.

## Scope references
- `clean-room-scope/architecture/client-app-runtime.md` § session store, § reactive subscriptions
- `clean-room-scope/features/agent-sessions.md`

## What to build
- **Session store** (Zustand + `subscribeWithSelector`): holds per-agent state (status, stream items,
  permissions, capabilities, usage, features, last activity), workspace descriptors, server info.
  Driven by daemon broadcast events via the client SDK's event emitter.
- **Selectors**: `useAgentStatus(agentId)`, `useAgentStream(agentId)`, `useAgentCapabilities(agentId)`,
  `useWorkspaceDescriptor(workspaceId)`, `useServerInfo()`, `useAgentDirectory()`.
- **React Query hooks**: `useSessionsQuery(serverId)` (list agents), `useAgentMutation()` (create/
  stop/archive), `usePermissionMutation()` (respond to permission).
- **Optimistic updates**: appending a user message optimistically before server confirms; rolling back
  on error.
- **Connection lifecycle integration**: subscribe on mount, teardown on disconnect, re-hydrate on
  reconnect (refetch active sessions).

## Acceptance criteria
- [ ] Session store updates reactively from daemon broadcasts; selectors return correct slices.
- [ ] React Query hooks fetch/mutate via the client SDK; optimistic message append works.
- [ ] Connection loss triggers loading state; reconnect re-subscribes and refetches.

## Test / verification plan
- Unit tests: store reducers (add agent, update status, append stream item, remove agent).
- Integration: mock client emitting events → verify store state transitions.
- Optimistic: append + confirm; append + error → rollback.
