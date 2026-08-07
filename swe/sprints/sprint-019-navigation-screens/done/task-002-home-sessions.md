# Task 002 — Home & Sessions screens

- **Sprint:** sprint-019-navigation-screens
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** sprint-018; sprint-013/task-003,005 (home/sessions + cross-host models)

## Goal
Build the per-host home (`/h/:serverId`), the global cross-host `/sessions` screen, and the shared agent
list — the primary "what's running" surfaces.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § home, § sessions, § cross-host

## What to build
- Host home (`/h/:serverId/index`): quick actions (New workspace / Open project), recent workspaces +
  active agents summary; consume the sprint-013 model.
- `/sessions` (global) + `/h/:serverId/sessions`: a list of agents/workspaces grouped by host/project,
  with status dots, attention, last-activity; tap → open the workspace/agent route.
- `AgentList` component (label, provider icon, status bucket, attention) reused across home/sessions and
  later the subagents track.
- Empty/loading/error states per the screen model.

## Out of scope
- Open-project/new-workspace (task-003). Schedules (task-005). The workspace shell itself (sprint-020).

## Acceptance criteria
- [ ] Host home shows quick actions + recents/active and routes correctly.
- [ ] `/sessions` lists agents grouped by host/project with status + attention and opens targets.
- [ ] Empty/loading/error states render per the model.

## Test / verification plan
- Tests: sessions grouping/sort + status mapping (reuse sprint-013 model); agent-list item rendering;
  route targets on select.

## Notes
- Reuse the AgentList in sprint-022 subagents track for visual consistency.
