# Task 003 — Pi-Studio worktree service + auto-archive coupling — Summary

- **Sprint:** sprint-008-projects-worktrees-git
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/projects/worktree-service.ts` — `WorktreeService`:
- **Name resolution** — `slugBranchName()` (lowercase, keep `[a-z0-9-/]`, collapse separators) and
  `resolveWorktreeName(raw, existing, maxLen=60)`: returns the slug when short + unique, else
  truncates and appends a **deterministic** 7-char sha256 suffix, incrementing a salt until unique
  within `existing`.
- **`createWorktree(intent)`** — resolves the target branch (existing `branch`, else a new branch
  from `name`/generated `generateBranchName(prompt)`/`generatePrompt`), runs
  `git worktree add [-b <branch>] <root>/<name> [<baseRef>]`, registers a `kind="worktree"`
  workspace, runs `pi-studio.json` `worktree.setup` streaming `workspace_setup_progress` with env
  `PI_STUDIO_WORKTREE_PATH` + `PI_STUDIO_SOURCE_CHECKOUT_PATH`, broadcasts `workspace_update`. Root
  defaults to `$PI_STUDIO_HOME/worktrees`, overridable via `worktreeRoot` (daemon-config
  `worktrees.root`).
- **`archiveWorktree(workspaceId)`** — runs `teardown`, archives every agent whose cwd is inside the
  worktree (`archiveAgent`, cascades), `git worktree remove --force` + `prune`, sets `archivedAt`,
  broadcasts.
- **Auto-archive coupling** — `maybeAutoArchiveOnTerminalTurn(agent)` archives the agent + worktree
  when the agent carries `pi-studio.auto-archive=true` + `pi-studio.worktree-workspace-id` (the hook
  left open in sprint-006). Label constants exported.
- Handlers: `create_pistudio_worktree_request`, `pistudio_worktree_list_request`,
  `pistudio_worktree_archive_request`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/projects/worktree-service.ts` | created |
| `packages/server/src/projects/index.ts` | modified (re-export) |
| `packages/server/src/projects/worktree-service.test.ts` | added — 5 tests (real temp git repo) |

## Build & test results
```
$ npm run build:server                                          → exit 0
$ npx vitest run packages/server/src/projects/worktree-service.test.ts → 5 passed
$ npx oxlint / oxfmt --check packages/server/src/projects        → clean
```

## Acceptance criteria
- [x] Creating a worktree adds a git worktree, registers a `worktree` workspace, and runs `setup`.
- [x] Archiving runs `teardown`, archives contained agents, and removes the git worktree.
- [x] `autoArchive` + `worktree` archives both agent and worktree after the first terminal turn.
- [x] Colliding/over-long names get a deterministic hash suffix; root honors `worktrees.root`.

## Follow-ups / TODO(verify)
- Full setup/teardown env var set and `CreatePi-StudioWorktreeRequest` intent rules (modeled the
  documented vars + a branch/name/baseRef intent).
- MCP/CLI worktree commands are wired in sprints 010/011.
