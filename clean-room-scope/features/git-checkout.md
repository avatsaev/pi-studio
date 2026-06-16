# Git Checkout & GitHub — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [projects-workspaces.md](projects-workspaces.md), [worktrees.md](worktrees.md),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md),
> [../architecture/structured-generation.md](../architecture/structured-generation.md)

## Purpose

Pi-Studio exposes git operations for a workspace's checkout — status, diffs, branch switching/renaming,
commit, push, pull, merge-from-base, stash — plus GitHub PR operations (create, merge, status,
timeline, auto-merge) and branch/PR utilities. Diffs and statuses are projected and streamed so
clients show live git state.

## Public Contract

### Status & diff (subscriptions)
| Operation | Message |
|-----------|---------|
| Status projection (live) | `checkout_status_update` |
| Diff subscribe/unsubscribe | subscribe/unsubscribe checkout-diff requests, `checkout_diff_update` |
| Refresh | `CheckoutRefreshRequest` (gated by `features.checkoutRefresh`) |

### Git operations (request → response)
`CheckoutCommitRequest`, `CheckoutMergeRequest`, `CheckoutMergeFromBaseRequest`,
`CheckoutPullRequest`, `CheckoutPushRequest`, `CheckoutSwitchBranchRequest`,
`CheckoutRenameBranchRequest`, `StashSaveRequest`, `StashPopRequest`, `StashListRequest`,
`ValidateBranchRequest`, `BranchSuggestionsRequest`.

### GitHub operations
`CheckoutPrCreateRequest`, `CheckoutPrMergeRequest` (legacy flat) and the namespaced
`checkout.github.set_auto_merge.request`/`.response` (gated by `features.checkoutGithubSetAutoMerge`),
`CheckoutPrStatusRequest`, `PullRequestTimelineRequest`, `GitHubSearchRequest`.

### Auto-merge request shape (example of dotted RPC)
```
{ type: "checkout.github.set_auto_merge.request", cwd, enabled, mergeMethod, requestId }
→ { type: "checkout.github.set_auto_merge.response",
    payload: { cwd, enabled, success, error, requestId } }
```

### Auto-archive on merge
- A workspace/agent may auto-archive once its PR is safely merged (`auto-archive-on-merge/`).

## Behavior & Algorithms

```
function statusProjection(cwd):
    read git status (branch, ahead/behind, staged/unstaged/untracked, conflicts)
    project to a stable client shape
    stream checkout_status_update on changes (watch-driven)

function commit(cwd, message?):
    if no message: generate via structured generation (commit-message task)
    stage per request; git commit
    update status projection

function createPr(cwd, ...):
    push branch if needed
    generate PR title/body via structured generation when not provided
    gh/GitHub API create PR; return PR ref + status

function setAutoMerge(cwd, enabled, mergeMethod):
    enable/disable GitHub auto-merge for the PR; return success/error
```

- Commit messages, PR title/body, and branch names use the daemon's structured generation fallback
  order. See [../architecture/structured-generation.md](../architecture/structured-generation.md).
- Branch operations validate names (`ValidateBranchRequest`) and offer suggestions
  (`BranchSuggestionsRequest`); branches are slugged.
- New GitHub RPCs are namespaced under `checkout.github.*`; generic git RPCs stay provider-neutral
  (see [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)).

## Data & Persistence
- Git state lives in the actual repository, not in Pi-Studio stores. Diff/status are projected/streamed,
  not persisted. PR/branch metadata is read live via `gh`/GitHub API.

## Error Handling & Edge Cases
| Condition | Expected behavior | Surface |
|-----------|-------------------|---------|
| Merge conflict | Surfaced in status projection; operation reports failure | response/status |
| Push rejected (non-fast-forward) | Operation fails with git error | `rpc_error`/response error |
| GitHub auth missing | PR operations fail with auth error | response `error` |
| Old daemon without `checkoutGithubSetAutoMerge` | Client hides feature ("update host") | feature gate |
| Branch name invalid | `ValidateBranchRequest` rejects; suggestions offered | response |
| Detached/non-git workspace | Git ops unavailable | response error |

## Dependencies
- Internal: workspace-git-service, checkout-diff-manager, status-projection, github-service,
  structured generation, auto-archive-on-merge.
- External: git CLI, GitHub `gh` CLI / API.

## Acceptance Criteria
- [ ] Status changes stream as `checkout_status_update` without polling.
- [ ] A commit without a message generates one via structured generation.
- [ ] PR creation pushes the branch and returns a PR reference.
- [ ] `checkout.github.set_auto_merge` toggles GitHub auto-merge and echoes `requestId`.
- [ ] A client on an old daemon hides auto-merge instead of failing silently.
- [ ] Merge conflicts surface in the status projection.

## TODO(verify)
- [ ] Full field shapes for each checkout request/response.
- [ ] Diff projection format and chunking.
- [ ] Exact GitHub API/`gh` invocation surface.
