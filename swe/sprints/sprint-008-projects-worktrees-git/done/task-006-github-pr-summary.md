# Task 006 — GitHub PR operations + auto-archive-on-merge — Summary

- **Sprint:** sprint-008-projects-worktrees-git
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/projects/github-service.ts` — `GitHubService` over the `gh` CLI (injectable
`GhRunner` since `gh` isn't installed in CI):
- **`createPr()`** — checks `gh auth status` (missing → `github_auth_required`); pushes the branch
  (`git push --set-upstream origin HEAD`, tolerating up-to-date); generates PR title/body via
  structured generation when absent; runs `gh pr create`; returns `{ ok, pr:{ number, url } }`.
- **`mergePr()`**, **`prStatus()`** (parses `state`/`mergedAt`), **`prTimeline()`**, **`search()`**.
- **`setAutoMerge(cwd, enabled, method)`** → `gh pr merge --auto --<method>` / `--disable-auto`,
  returns `{ success, error }`.
- **Handlers:** `checkout_pr_create_request`, `checkout_pr_merge_request` (legacy flat),
  `checkout_pr_status_request`, `pull_request_timeline_request`, `github_search_request`, and the
  namespaced **`checkout.github.set_auto_merge.request`** → `.response` whose `payload` echoes
  `{ cwd, enabled, success, error, requestId }`. The dotted RPC is registered **only when**
  `setAutoMergeEnabled` (`features.checkoutGithubSetAutoMerge`) is true — an old daemon omits the
  handler so clients hide the affordance.
- **`autoArchiveOnMerge(cwd, workspaceId)`** — archives the workspace via the injected
  `archiveWorkspace` callback once `prStatus` reports the PR merged.
- Auth errors classified from `gh` output (`classifyGhError`).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/projects/github-service.ts` | created |
| `packages/server/src/projects/index.ts` | modified (re-export) |
| `packages/server/src/projects/github.test.ts` | added — 6 tests (stubbed `gh`) |

## Build & test results
```
$ npm run build:server                                      → exit 0
$ npx vitest run packages/server/src/projects/github.test.ts → 6 passed
$ npx oxlint / oxfmt --check packages/server/src/projects    → clean
```

## Acceptance criteria
- [x] PR creation pushes the branch and returns a PR reference (`{ number, url }`).
- [x] `checkout.github.set_auto_merge` toggles auto-merge and echoes `requestId` (in `payload`).
- [x] A client on an old daemon hides auto-merge — the handler isn't registered when the feature is
      disabled (verified `registry.get(...)` is undefined).
- [x] Missing GitHub auth surfaces an auth error (`github_auth_required`) in the response.
- [x] A merged PR triggers auto-archive of its workspace/agent.

## Follow-ups / TODO(verify)
- Exact `gh`/GitHub API invocation surface + PR/timeline JSON field sets (modeled common `gh --json`
  fields). Non-GitHub forges and UI affordances are out of scope.
