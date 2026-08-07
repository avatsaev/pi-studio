# Task 002 — Register all real feature handlers in the production daemon

- **Sprint:** sprint-035-production-daemon
- **Status:** done
- **Estimated size:** L
- **Depends on:** task-001

## Problem
The daemon must expose every RPC the app calls. dev-bootstrap only wired core agent/session/timeline/
permissions + stub `list_projects`/`list_workspaces`/`schedule_list` (empty) + file explorer. The
real services exist but aren't registered.

## Scope references
- Services to register (all have `registerHandlers`): `projects/open-project.ts` (OpenProjectService),
  `projects/git-operations.ts` (GitOperationsService), `projects/git-checkout-rpc.ts`
  (`registerGitCheckoutHandlers`), `projects/github-service.ts` (GitHubService),
  `projects/worktree-service.ts`, `files/file-transfer.ts` (FileTransferService),
  `proxy/service-proxy.ts` (ServiceProxy). Orchestration: schedules/heartbeats, chat rooms, loops
  (`persistence/entity-stores.ts` has the stores).
- `clean-room-scope/features/projects-workspaces.md, git-checkout.md, file-explorer-transfer.md, service-proxy.md, schedules-heartbeats.md, chat-rooms.md, loops.md`

## What to build
- Instantiate + register the real **projects/workspaces registry** and `open_project_request`,
  `list_projects_request`, `list_workspaces_request`, `archive_workspace_request` (backed by the disk
  registries in `entity-stores.ts`), replacing dev's empty stubs.
- Register **git**: status/diff subscribe, checkout ops (commit/push/pull/merge/branch/stash),
  `checkout_refresh`, and **GitHub PR** handlers.
- Register **file transfer** (download token/download/upload) alongside the file explorer.
- Register **service proxy** (workspace scripts) + expose scripts/setup info for the workspace header.
- Register **schedules/heartbeats**, **chat rooms**, **loops** handlers backed by the disk stores.
- Ensure broadcasts (agent_update, workspace_update, checkout status/diff) go to active sessions.

## Acceptance criteria
- [ ] Every RPC the app issues has a registered handler (no "no handler for X" errors when driving
      the app: sessions, projects, workspaces, git status/diff, schedules, file explorer/transfer).
- [ ] `open_project_request` against a real git repo creates a workspace and returns it in
      `list_workspaces_request`.
- [ ] Git status/diff for a real repo returns real data.
- [ ] `npm run build:server` + `npx vitest run packages/server` pass.

## Test / verification plan
- Unit/integration: in-process daemon (temp home) — register handlers, exercise open-project + git
  status against a temp git repo; schedules CRUD round-trip.
