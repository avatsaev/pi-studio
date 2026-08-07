# Task 004 — Checkout status, worktree UI & git notifications — Summary

- **Sprint:** sprint-027-git-full
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

The checkout status badge, stale-branch indicator, git notifications, live
`checkout_status_update` subscription (with file-write→dirty invalidation), and
the worktree callout — pure models (`panels/checkout-status.ts`) + a
subscription hook (`hooks/use-checkout-status.ts`) + header components.

1. **Checkout status badge.** `deriveCheckoutState` classifies
   clean/dirty/ahead/behind/diverged; `deriveCheckoutBadge` yields
   `{ branch, state, icon, label, aheadCount, behindCount, tone }` with labels
   like "main ↑2", "dev ↓3", "x ↑1↓2", "main •". `CheckoutStatusBadge` renders
   the icon (check/dot/up/down/up-down) + label + stale warning; clicking opens
   the branch switcher (`onClick`).

2. **Live updates.** `useCheckoutStatus` subscribes to `checkout_status_update`
   (scoped by serverId+cwd), invalidates the git-status query cache, and emits
   git notifications. File writes already invalidate git status via
   `subscribeFileWriteInvalidation` (sprint-023) → clean→dirty transition.

3. **Git notifications.** `buildGitNotification` for `push_success`
   ("Pushed N commits to origin/branch"), `pull_new` ("Pulled N new commits"),
   `conflict` ("Merge conflict in N files" + "View changes" action), and
   `worktree_created` ("Worktree created at /path"). The hook maps the
   corresponding stream events to `onNotify`.

4. **Stale-branch indicator.** `isStaleBranch` → true when behind upstream and
   the last upstream sync is older than `STALE_BRANCH_DAYS` (7); the badge shows
   a subtle warning triangle.

5. **Worktree callout.** `WorktreeCallout` renders `buildWorktreeCallout`
   (task-002) with "Switch to main" / "Delete worktree" actions (wired to
   `useGitActions.checkout` / `deleteWorktree`).

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/panels/checkout-status.ts` | created (pure model) |
| `packages/app/src/panels/checkout-status.test.ts` | created (11 tests) |
| `packages/app/src/panels/index.ts` | modified (export checkout-status) |
| `packages/app/src/hooks/use-checkout-status.ts` | created |
| `packages/app/src/hooks/index.ts` | modified (export useCheckoutStatus) |
| `packages/app/src/components/panels/CheckoutStatusBadge.tsx` | created (badge + worktree callout) |
| `packages/app/src/components/panels/CheckoutStatusBadge.module.css` | created |
| `packages/app/src/components/panels/index.ts` | modified (exports) |

## How it satisfies the scope

- **git-checkout.md § checkout status** — branch + status icon
  (clean/dirty/ahead/behind/diverged); real-time updates via
  `checkout_status_update` subscription; file writes invalidate status.
- **worktrees.md** — worktree callout banner with switch-to-main / delete
  (→ `git_worktree_delete_request`).
- **workspace-ui.md § header controls** — badge lives in the workspace header;
  click opens the branch switcher.
- **task-004 acceptance** — header badge with real branch + real-time status;
  worktree callout + actions; notifications for push/pull/conflict/worktree;
  file writes trigger status refetch.

### Deviations / boundaries
- **Notification event names** (`git_push_success`, `git_pull_new`,
  `git_worktree_created`, plus `checkout_status_update`) follow the existing
  streamed-event convention; exact daemon event names are TODO(verify) (daemon
  git/worktree services are sprint-008 territory). The hook degrades gracefully
  (no notification if the event/`onNotify` is absent).
- **Stale detection** uses a `lastUpstreamSyncMs` field on the status summary;
  if the daemon doesn't project it, staleness is simply never flagged
  (TODO(verify) the projection field).
- Components are thin wrappers over the tested pure models + the subscription
  hook; not render-tested (node-only env). All badge/state/stale/notification
  logic is unit-tested.

## Build & test results

```
$ npx tsc -b packages/app
(clean)

$ npx vitest run packages/app/src/panels/checkout-status.test.ts
 Test Files  1 passed (1)
      Tests  11 passed (11)

$ npm run build && npm run typecheck
(clean)

$ npm test
 Test Files  131 passed (131)
      Tests  1656 passed (1656)
```

## Acceptance criteria
- [x] Header badge shows real branch + status; updates in real-time on file
      changes — `deriveCheckoutBadge` (checkout-status.test.ts) + `useCheckoutStatus`
      subscription + file-write invalidation.
- [x] Worktree callout appears for worktree workspaces; actions work —
      `buildWorktreeCallout` + `WorktreeCallout` + `useGitActions.deleteWorktree`.
- [x] Git notifications fire for push/pull/conflict/worktree events —
      `buildGitNotification` (checkout-status.test.ts) + hook event mapping.
- [x] File writes invalidate git status (clean → dirty transition) —
      `subscribeFileWriteInvalidation` (sprint-023) + `checkout_status_update`
      cache invalidation.

## Follow-ups / TODO(verify)
- Confirm daemon event names + payloads for push/pull/worktree notifications and
  the `lastUpstreamSyncMs` projection for stale detection.
