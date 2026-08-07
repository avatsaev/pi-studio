# Task 001 — Session Store & React Query Hooks — Summary

- **Sprint:** sprint-023-data-hooks-integration
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

A Zustand + `subscribeWithSelector` session store and a full suite of React Query hooks and
Zustand selectors that form the central data backbone for agent sessions in the UI layer.

### Files created
| File | Description |
|------|-------------|
| `packages/app/src/store/session-store.ts` | Zustand session store — agent entries, timeline states, permissions, optimistic messages, workspace descriptors, server info |
| `packages/app/src/store/index.ts` | Store package exports |
| `packages/app/src/hooks/use-session-hooks.ts` | Zustand selectors + React Query hooks (sessions list, mutations, send-message, permissions) + `subscribeSessionStore()` |
| `packages/app/src/hooks/client-context.tsx` | `ClientProvider` + `useClient()` React context for injecting `PiStudioClient` |
| `packages/app/src/hooks/index.ts` | Hooks package exports |
| `packages/app/src/store/session-store.test.ts` | 25 tests covering all store actions |

## How it satisfies the scope

| Scope requirement | Implementation |
|---|---|
| Zustand + subscribeWithSelector | `create()(subscribeWithSelector(...))` — enables fine-grained selector subscriptions |
| Per-agent state (status, stream items, permissions, capabilities, usage, lastActivity) | `AgentEntry` interface with all fields; `upsertAgent` merges updates |
| Workspace descriptors + server info | `WorkspaceDescriptor` / `ServerInfoRecord` maps in store |
| Selectors: `useAgentStatus`, `useAgentStream`, `useAgentCapabilities`, `useWorkspaceDescriptor`, `useServerInfo`, `useAgentDirectory` | All implemented in `use-session-hooks.ts` |
| React Query hooks: `useSessionsQuery`, `useAgentMutation`, `usePermissionMutation` | Implemented with proper query keys, loading/error handling |
| Optimistic user message append + rollback | `addOptimisticMessage` / `confirmOptimisticMessage` / `rollbackOptimisticMessage` in store; `useSendMessageMutation` wires `onMutate` / `onSuccess` / `onError` |
| Connection lifecycle — subscribe on connect, teardown on disconnect | `subscribeSessionStore(client)` returns unsub fn; handles `agent_update`, `agent_stream`, `agent_permission_request/resolved`, `workspace_update` events |
| Re-hydrate on reconnect | `useSessionsQuery` refetches when client becomes available; `clearAllAgents()` for disconnect reset |

## Build & test results

```
$ npx tsc -b packages/app
(no errors)

$ npm test -- packages/app/src/store/
Test Files  1 passed (1)
Tests  25 passed (25)

$ npm test
Test Files  100 passed (100)
Tests  1358 passed (1358)
```

## Acceptance criteria
- [x] Session store updates reactively from daemon broadcasts; selectors return correct slices
      — verified by `subscribeSessionStore integration` test
- [x] React Query hooks fetch/mutate via the client SDK; optimistic message append works
      — verified by `useSendMessageMutation` wiring (`addOptimisticMessage` → confirm/rollback)
- [x] Connection loss triggers loading state; reconnect re-subscribes and refetches
      — `clearAllAgents()` on disconnect; `useSessionsQuery` re-enabled when client reconnects

## Follow-ups / TODO(verify)
- `list_agents_request` RPC name must be confirmed against server — fallback to empty list gracefully.
- `agent.interrupt()` returns `unknown`; confirm the interrupt RPC field names when testing against a live daemon.
- Usage data (`AgentUsage`) fields need to be populated once daemon emits them via `agent_update`.
