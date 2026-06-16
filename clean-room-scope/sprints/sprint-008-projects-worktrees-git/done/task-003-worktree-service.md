# Task 003 — Pi-Studio worktree service + auto-archive coupling

- **Sprint:** sprint-008-projects-worktrees-git
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-002; task-003 (sprint-003, pi-studio.json); task-006 (sprint-006, branch names)

## Goal
Implement Pi-Studio-managed git worktrees with setup/teardown lifecycle and auto-archive coupling.

## Scope references
- `clean-room-scope/features/worktrees.md` § Operations, § Behavior, § Lifecycle config
- `clean-room-scope/architecture/agent-lifecycle.md` § Archive (auto-archive + worktree)

## What to build
- Operations: `CreatePi-StudioWorktreeRequest`, `Pi-StudioWorktreeListRequest`, `Pi-StudioWorktreeArchiveRequest`
  (MCP/CLI mirrors wired later).
- `createWorktree(intent)`: resolve target branch (existing/new; generate name via structured
  generation if requested, slug + deterministic hash suffix for collisions/limits);
  `git worktree add {root}/{name} <branch>`; register `kind="worktree"` workspace under the project;
  run `pi-studio.json` `worktree.setup` (stream `workspace_setup_progress`) with env
  `PI_STUDIO_WORKTREE_PATH`, `PI_STUDIO_SOURCE_CHECKOUT_PATH`.
- `archiveWorktree(name)`: run `teardown`; archive agent records inside; `git worktree remove`/prune;
  set workspace `archivedAt`.
- Auto-archive coupling: an agent created with `autoArchive` + `worktree` target archives the agent
  **and** its worktree after the first terminal turn (`turn_completed`/`failed`/`canceled`). Wire the
  `autoArchive` hook left open in sprint-006.
- Worktree root default `$PI_STUDIO_HOME/worktrees`, override via `worktrees.root`.

## Out of scope
- Git status/diff (task-004). MCP/CLI worktree commands (sprint-010/011).

## Acceptance criteria
- [ ] Creating a worktree adds a git worktree, registers a `worktree` workspace, and runs `setup`.
- [ ] Archiving runs `teardown`, archives contained agents, and removes the git worktree.
- [ ] `autoArchive` + `worktree` archives both agent and worktree after the first terminal turn.
- [ ] Colliding/over-long names get a deterministic hash suffix; root honors `worktrees.root`.

## Test / verification plan
- Tests: `npx vitest run .../worktree-service.test.ts` in a temp git repo — create/setup, archive/teardown,
  auto-archive coupling, name collision suffix.

## Notes
- Full setup/teardown env var set and `CreatePi-StudioWorktreeRequest` intent rules are TODO(verify).
