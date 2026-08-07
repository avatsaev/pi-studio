# Task 004 — Schedules, projects & navigation hooks

- **Sprint:** sprint-023-data-hooks-integration
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001; sprint-010 (orchestration), sprint-008 (projects)

## Goal
Build React Query hooks for schedules, projects/workspaces, and navigation state so all
navigation screens render from real daemon data.

## Scope references
- `clean-room-scope/features/schedules-heartbeats.md`
- `clean-room-scope/features/projects-workspaces.md`
- `clean-room-scope/features/app-navigation-screens.md`

## What to build
- **Schedule hooks**: `useSchedulesQuery(serverId)` → list; `useScheduleMutation()` → create/update/
  delete/toggle/run-now; `useScheduleHistory(scheduleId)` → past runs.
- **Project hooks**: `useProjectsQuery()` → registered projects across hosts; `useProjectMutation()` →
  register/unregister/update; `useWorkspacesQuery(serverId)` → workspace list for sidebar.
- **Navigation store**: Zustand store tracking active-workspace-id, sidebar collapsed sections, sidebar
  sort order, last workspace selection per host. Persisted to KV store (IndexedDB).
- **Host connection hooks**: `useHostConnection(serverId)` → connection status + reconnect trigger;
  `useMultiHostAggregator()` → aggregates data across connected hosts for cross-host screens.
- **Sidebar integration**: wire the LeftSidebar component to real workspace list + host switcher from
  these hooks.

## Acceptance criteria
- [ ] Schedules screen shows real data from daemon; create/toggle/run-now mutations work.
- [ ] Projects screen lists registered projects; register/unregister works.
- [ ] Sidebar renders real workspace list grouped by project; host switcher reflects connected hosts.
- [ ] Navigation state (active workspace, collapsed sections) persists across refreshes.

## Test / verification plan
- Hook tests with mock client: verify query keys, loading/error states, mutation optimistic updates.
- Navigation store: persist → reload → verify state restored from KV.
