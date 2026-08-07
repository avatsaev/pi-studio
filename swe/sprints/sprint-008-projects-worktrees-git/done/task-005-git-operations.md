# Task 005 — Git operations (commit/push/pull/merge/branch/stash)

- **Sprint:** sprint-008-projects-worktrees-git
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-004; task-006 (sprint-006, structured generation)

## Goal
Implement the provider-neutral git mutation operations with structured-generation-backed commit
messages and branch utilities.

## Scope references
- `clean-room-scope/features/git-checkout.md` § Git operations, § Behavior (commit), § Error Handling
- `clean-room-scope/architecture/structured-generation.md` (commit message / branch name tasks)

## What to build
- Handlers: `CheckoutCommitRequest`, `CheckoutMergeRequest`, `CheckoutMergeFromBaseRequest`,
  `CheckoutPullRequest`, `CheckoutPushRequest`, `CheckoutSwitchBranchRequest`,
  `CheckoutRenameBranchRequest`, `StashSaveRequest`/`StashPopRequest`/`StashListRequest`,
  `ValidateBranchRequest`, `BranchSuggestionsRequest`.
- `commit(cwd, message?)`: if no message → generate via structured generation; stage per request;
  commit; refresh status projection.
- Branch names validated (`ValidateBranchRequest`) + suggested (`BranchSuggestionsRequest`), slugged.
- Surface git errors (merge conflict, non-fast-forward push) as response errors / `rpc_error`.

## Out of scope
- GitHub PR operations (task-006).

## Acceptance criteria
- [ ] A commit without a message generates one via structured generation.
- [ ] Switch/rename/merge/pull/push/stash operations execute and update the status projection.
- [ ] Push rejected (non-fast-forward) fails with a git error surfaced to the client.
- [ ] Invalid branch names are rejected; suggestions offered.

## Test / verification plan
- Tests: `npx vitest run .../git-ops.test.ts` in temp repos — commit (auto-message), branch switch/rename,
  stash round-trip, push-reject error.

## Notes
- Full per-request field shapes are TODO(verify).
