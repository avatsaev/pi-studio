# Task 002 — Open-project flow + workspace updates — Summary

- **Sprint:** sprint-008-projects-worktrees-git
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/projects/`:
- **`git-detect.ts`** — `detectGit(path, runner?)` → `{ isGit, rootPath, remote, branch }` via the
  `git` CLI (injectable `GitRunner`, never throws). Uses `rev-parse --show-toplevel`,
  `remote get-url origin`, and `symbolic-ref --short HEAD` (works on an unborn branch; falls back to
  `rev-parse --abbrev-ref HEAD` for detached HEAD).
- **`workspace-activity.ts`** — `aggregateWorkspaceActivity(agents)` → `Map<cwd, WorkspaceBucket>`.
  Root agents contribute their own bucket (running/error/attention/idle/closed); a **running**
  subagent escalates `running` to its **root parent's** workspace (`resolveRoot` walks parent links,
  cycle-safe); non-running subagent attention/error stays in the parent's track (no escalation).
- **`open-project.ts`** — `OpenProjectService`:
  - `openProject(path)`: detect git → resolve/create Project by `projectKey` (git → `local_checkout`,
    non-git → `kind=non_git` + `directory`) → resolve/create workspace → broadcast `workspace_update`.
  - Handlers: `open_project_request`, `archive_workspace_request` (+ broadcast),
    `workspace_clear_attention`, `directory_suggestions_request` (lists subdirs),
    `workspace_setup_status_request`, `project_icon_request`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/projects/git-detect.ts` | created |
| `packages/server/src/projects/workspace-activity.ts` | created |
| `packages/server/src/projects/open-project.ts` | created |
| `packages/server/src/projects/index.ts` | modified (re-exports) |
| `packages/server/src/projects/workspace-registry.ts` | modified (removed dup `GitDetection`) |
| `packages/server/src/projects/open-project.test.ts` | added — 6 tests (real temp git repo) |

## Build & test results
```
$ npm run build:server                              → exit 0
$ npx vitest run packages/server/src/projects/      → 17 passed (3 files)
$ npx oxlint / oxfmt --check packages/server/src/projects → clean
```

## Acceptance criteria
- [x] Opening a git project derives a remote `projectKey` and registers a `local_checkout`.
- [x] Opening a non-git dir → project `kind=non_git`, workspace `kind=directory`.
- [x] A running subagent escalates `running` to its root parent's workspace bucket, not its own cwd.
- [x] `workspace_update` broadcasts on registration/state change (open + archive).

## Follow-ups / TODO(verify)
- Exact `OpenProjectRequest`/`workspace_update` payload fields and `ProjectIconRequest` resolution
  (icon returned `null`).
- Fresh-worktree setup runs are triggered by the worktree service (task-003).
