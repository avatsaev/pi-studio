# Task 004 — Git status/diff projections + streaming

- **Sprint:** sprint-008-projects-worktrees-git
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-002

## Goal
Implement live git status and diff projections streamed to clients.

## Scope references
- `clean-room-scope/features/git-checkout.md` § Status & diff, § Behavior (statusProjection)
- `clean-room-scope/architecture/websocket-protocol.md` § Session message families (checkout_*)

## What to build
- `workspace-git-service` + `status-projection`: read git status (branch, ahead/behind,
  staged/unstaged/untracked, conflicts); project to a stable client shape; stream
  `checkout_status_update` on change (watch-driven, no polling).
- `checkout-diff-manager`: subscribe/unsubscribe diff requests; stream `checkout_diff_update`
  (chunked/projected).
- `CheckoutRefreshRequest` (gated by `features.checkoutRefresh`).

## Out of scope
- Mutating git ops (task-005). GitHub PRs (task-006). Syntax highlighting of diffs (task-007).

## Acceptance criteria
- [ ] Status changes stream as `checkout_status_update` without polling.
- [ ] Diff subscribe yields `checkout_diff_update`; unsubscribe stops it.
- [ ] Merge conflicts appear in the status projection.
- [ ] Detached/non-git workspaces report git ops unavailable.

## Test / verification plan
- Tests: `npx vitest run .../git-status.test.ts` in a temp git repo — status projection on edits,
  conflict surfacing, diff subscription.

## Notes
- Diff projection format/chunking is TODO(verify).
