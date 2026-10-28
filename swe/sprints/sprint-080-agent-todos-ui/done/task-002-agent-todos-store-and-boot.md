# Task 002 — `agent-todos-store.ts` + connection boot hook + persisted collapse

- **Sprint:** sprint-080-agent-todos-ui
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (features/chat/todos, app boot)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

One app-scoped store holds every agent's snapshot and the per-agent collapse flag, kept current by
one push subscription per connection and refetched on every reconnect.

## Context / why

The daemon restarts `seq` at 1 on restart, so a reconnect must reset seq tracking and re-list every
agent a pane is showing (spec § Multi-pane, sub-agents, reconnect). An old daemon must see zero
requests (U9). A failed list keeps whatever snapshot exists, with no toast.

## Scope references

- swe/features/agent-todos-ui.md § Public contract (store), § Multi-pane, sub-agents, reconnect,
  § Error handling & edge cases
- packages/web-client/src/hooks/use-viewer-settings.ts:21-35 (connection-scoped effect: one push
  subscription per `open` connection, mounted once in `app.tsx`'s `Boot`). This is the lifecycle
  pattern to copy. It is an effect on `status`, so the agent-ui store's `queueMicrotask` deferral
  is not needed here.
- packages/web-client/src/viewer-plugins/viewer-settings-store.ts:60-85 (capability-gated hydrate)
- packages/web-client/src/lib/connection/connection-store.ts (`client`, `status`)
- packages/web-client/src/lib/pane-layout-persistence.ts:151 (`schedulePaneLayoutWrite`, the
  250 ms trailing-debounce write)
- sprint-079 task-008: `applyAgentTodosSnapshot`, `resetAgentTodosSeq`, `snapshotFor`,
  `listAgentTodos`, `onAgentTodosUpdate`, `hasAgentTodosCapability`

## What to build

`features/chat/todos/agent-todos-store.ts` (zustand):
- State: the SDK `AgentTodosState`, `tracked: Map<agentId, refcount>`, `collapsed: Set<agentId>`.
- `track(agentId) → release`:
  - Refcounted: two panes on one agent make one request.
  - On the first track while connected with the capability, it calls `listAgentTodos` and applies
    the result through the reducer.
  - A rejection is swallowed: the snapshot is kept, nothing is logged above `debug`, no toast.
- `refetchTracked()` resets seq and lists every tracked agent.
- `applyUpdate(snapshot)` goes through the reducer, for any agent.
- `clear()` drops every snapshot, for a daemon without the capability.
- `setCollapsed(agentId, bool)` updates the set and schedules a debounced write (task-001's codec,
  `localKvStore`). The set is read once at store creation.
- Selector hooks: `useAgentTodosSnapshot(agentId)` and `useTodoPanelCollapsed(agentId)`.

`hooks/use-agent-todos.ts`: `useAgentTodosBoot()`, mounted once in `app.tsx`'s `Boot` next to
`useViewerSettingsBoot()`. When `status === "open"`:
- with the capability: subscribe `onAgentTodosUpdate`, then `refetchTracked()`;
- without it: `clear()`, and no requests.

On any other status, keep the snapshots. The next open resets seq before they can go stale.

## Out of scope

- The component (task-003)

## Acceptance criteria

- [ ] Store tests with a fake client:
  - track lists once per agent and a second track does not re-list;
  - a rejection keeps the prior snapshot;
  - a stale push is dropped;
  - after `refetchTracked()`, a seq-1 list result replaces a seq-7 snapshot;
  - without the capability, zero requests are sent.
- [ ] Collapse round trip through a fake `KeyValueStore`; writes are debounced (fake timers)
- [ ] `packages/web-client/AGENTS.md` source tree lists the new files

## Test / verification plan

- `agent-todos-store.test.ts` (follows `viewer-settings-store.test.ts`'s fake-client setup)
- `npx vitest run packages/web-client/src/features/chat/todos` and `npm run build:web-client`
