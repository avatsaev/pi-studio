# Task 002 — Open-project flow + workspace updates

- **Sprint:** sprint-008-projects-worktrees-git
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Implement the open-project RPC flow, workspace activity aggregation, and related workspace RPCs.

## Scope references
- `clean-room-scope/features/projects-workspaces.md` § RPCs/operations, § Open project, § Workspace activity bucket
- `clean-room-scope/architecture/agent-lifecycle.md` § Lifecycle status semantics (workspace aggregate)

## What to build
- Handlers: `OpenProjectRequest`, `ArchiveWorkspaceRequest`, `WorkspaceClearAttentionMessage`,
  `WorkspaceSetupStatusRequest` (+ `workspace_setup_progress`), `DirectorySuggestionsRequest`,
  `ProjectIconRequest`; broadcast `workspace_update` / `script_status_update`.
- `openProject(path)`: detect git (rootPath, remote, branch); resolve/create Project by `projectKey`;
  resolve/create the workspace for the cwd (kind = local_checkout|directory|worktree); register +
  broadcast `workspace_update`.
- Workspace activity bucket: aggregate — root agents contribute their state; a running subagent
  contributes `running` to its **root parent's** workspace, not its own cwd. Non-running subagent
  attention/error stays in the parent's track.

## Out of scope
- Worktree setup execution (task-003). Git status streaming (task-004).

## Acceptance criteria
- [ ] Opening a git project derives a remote `projectKey` and registers a `local_checkout`.
- [ ] Opening a non-git dir → project `kind=non_git`, workspace `kind=directory`.
- [ ] A running subagent escalates `running` to its root parent's workspace bucket, not its own cwd.
- [ ] `workspace_update` broadcasts on registration/state change.

## Test / verification plan
- Tests: `npx vitest run .../open-project.test.ts` — git/non-git detect, reuse existing, activity bucket.

## Notes
- Fresh-worktree setup runs are triggered here but executed by the worktree service (task-003).
