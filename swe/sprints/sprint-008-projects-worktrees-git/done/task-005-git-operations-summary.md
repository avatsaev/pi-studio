# Task 005 — Git operations (commit/push/pull/merge/branch/stash) — Summary

- **Sprint:** sprint-008-projects-worktrees-git
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/projects/git-operations.ts` — `GitOperationsService` (provider-neutral):
- **`commit(req)`** — stages (`all` → `git add -A`, or `paths`); when no message is given, generates
  one via structured generation (`generate("commit_message", { context:{ prompt: <staged --stat> }})`);
  commits; refreshes the status projection. Returns `{ ok, message, generated }`.
- **`switchBranch`** (`-c` create, slugged + validated), **`renameBranch`** (`branch -m`, slugged +
  validated), **`merge`** / **`mergeFromBase`** (`git merge`), **`pull`**, **`push`**
  (`--set-upstream`/remote/branch), **`stashSave`/`stashPop`/`stashList`**.
- **`validateBranchName()`** — `git check-ref-format --branch` + whitespace/empty checks.
- **`branchSuggestions(prompt)`** — `generate("branch_name")` → slug + variants (all whitespace-free).
- **Error surfacing** — git failures return `{ ok:false, error }`; merge conflicts →
  `merge_conflict` (and the conflict shows in the refreshed status projection); rejected pushes →
  `non_fast_forward`.
- Handlers registered for all the `checkout_*` / `stash_*` / `validate_branch` /
  `branch_suggestions` request types.
- Extended `GitRunResult` with `stderr` (defaultGitRunner now captures it) for error classification.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/projects/git-operations.ts` | created |
| `packages/server/src/projects/git-detect.ts` | modified (capture `stderr`) |
| `packages/server/src/projects/index.ts` | modified (re-export) |
| `packages/server/src/projects/git-ops.test.ts` | added — 5 tests (real temp repos) |

## Build & test results
```
$ npm run build:server                                     → exit 0
$ npx vitest run packages/server/src/projects/git-ops.test.ts → 5 passed
$ npx vitest run packages/server/src/projects/              → 34 passed (6 files)
$ npx oxlint / oxfmt --check packages/server/src/projects   → clean
```

## Acceptance criteria
- [x] A commit without a message generates one via structured generation.
- [x] Switch/rename/merge/pull/push/stash operations execute and update the status projection.
- [x] Push rejected (non-fast-forward) fails with a git error surfaced to the client
      (`non_fast_forward`, verified with a bare remote + diverged clones).
- [x] Invalid branch names are rejected; suggestions offered.

## Follow-ups / TODO(verify)
- Full per-request field shapes (modeled minimal `{cwd, ...}` request bodies).
- GitHub PR operations are task-006.
