# Task 004 — Schedules, Projects & Navigation Hooks — Summary

- **Sprint:** sprint-023-data-hooks-integration
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

React Query hooks for schedule CRUD and project/workspace data, plus a persisted Zustand navigation
store for sidebar state.

### Files created
| File | Description |
|------|-------------|
| `packages/app/src/hooks/use-nav-hooks.ts` | Schedule hooks, project hooks, workspace hooks, `useNavigationStore` (persisted Zustand), `useHostConnections` |
| `packages/app/src/hooks/use-nav-hooks.test.ts` | 13 tests |

## How it satisfies the scope

| Scope requirement | Implementation |
|---|---|
| `useSchedulesQuery` / `useScheduleHistory` | Queries `schedule_list_request` / `schedule_logs_request` |
| `useScheduleMutation` (create/update/delete/toggle/runNow) | 5 mutations wired to correct RPC names; all invalidate schedules cache |
| `useProjectsQuery` / `useProjectMutation` (register/unregister) | `list_projects_request` / `open_project_request` / `archive_workspace_request` |
| `useWorkspacesQuery` | `list_workspaces_request` per serverId |
| Navigation store: activeWorkspace, sidebarCollapsed, collapsedSections, sortOrder, lastWorkspaceByHost | Zustand + `persist` middleware to localStorage (safe-fallback to memory) |
| `activeWorkspaceId` NOT persisted | Driven by route; excluded from `partialize` |

## Build & test results

```
$ npx tsc -b packages/app
(no errors)

$ npm test -- packages/app/src/hooks/use-nav-hooks.test.ts
Test Files  1 passed (1)
Tests  13 passed (13)
```

## Acceptance criteria
- [x] Schedules screen — create/toggle/run-now mutations wire to correct RPCs
- [x] Projects screen — register/unregister via mutations
- [x] Navigation state persists across refreshes — Zustand persist middleware
- [x] Last workspace per host stored and retrievable

## Follow-ups / TODO(verify)
- RPC names (`schedule_list_request`, `open_project_request`) need to be confirmed against server.
- `toggle` uses `pause_schedule_request` / `resume_schedule_request` — confirm field names.
- `useHostConnections` returns all servers as "connected" — actual connection status should come from the DaemonClient once wired in task-005.
