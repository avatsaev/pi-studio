# Task 006 — GitHub PR operations + auto-archive-on-merge

- **Sprint:** sprint-008-projects-worktrees-git
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-005

## Goal
Implement GitHub PR operations (create/merge/status/timeline/search/auto-merge) including the
namespaced dotted RPC and auto-archive-on-merge.

## Scope references
- `clean-room-scope/features/git-checkout.md` § GitHub operations, § Auto-merge request shape, § Auto-archive on merge
- `clean-room-scope/architecture/websocket-protocol.md` § RPC naming convention

## What to build
- `github-service` via `gh` CLI / GitHub API.
- Handlers: `CheckoutPrCreateRequest`, `CheckoutPrMergeRequest` (legacy flat, still accepted),
  `checkout.github.set_auto_merge.request`/`.response` (gated by
  `features.checkoutGithubSetAutoMerge`), `CheckoutPrStatusRequest`, `PullRequestTimelineRequest`,
  `GitHubSearchRequest`.
- `createPr`: push branch if needed; generate PR title/body via structured generation when absent;
  create PR; return PR ref + status.
- `setAutoMerge(cwd, enabled, mergeMethod)` → echo `requestId`, `{ success, error }`.
- `auto-archive-on-merge`: archive workspace/agent once its PR is safely merged.

## Out of scope
- Non-GitHub forges. UI affordances (sprint-012).

## Acceptance criteria
- [ ] PR creation pushes the branch and returns a PR reference.
- [ ] `checkout.github.set_auto_merge` toggles auto-merge and echoes `requestId`.
- [ ] A client on an old daemon hides auto-merge (feature gate) instead of failing silently.
- [ ] Missing GitHub auth surfaces an auth error in the response.
- [ ] A merged PR triggers auto-archive of its workspace/agent.

## Test / verification plan
- Tests: `npx vitest run .../github.test.ts` with a stubbed `gh`/API — create, set-auto-merge echo,
  auth-error path, auto-archive-on-merge.

## Notes
- New GitHub RPCs are namespaced `checkout.github.*`; generic git RPCs stay provider-neutral. Exact
  `gh`/API invocation surface is TODO(verify).
