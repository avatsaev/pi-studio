# Task 004 — Checkout status, worktree UI & git notifications

- **Sprint:** sprint-024-git-full
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-002; sprint-008 (worktrees server)

## Goal
Build the checkout status indicator (branch + dirty + ahead/behind in workspace header),
worktree setup callout, and git-related notifications (push success, conflict detected, etc).

## Scope references
- `clean-room-scope/features/git-checkout.md` § checkout status
- `clean-room-scope/features/worktrees.md`
- `clean-room-scope/features/workspace-ui.md` § header controls

## What to build
- **Checkout status badge**: in workspace header, show current branch name + status icon:
  clean (checkmark), dirty (dot), ahead (↑N), behind (↓N), diverged (↕). Click → opens branch
  switcher. Subscribe to `git.status.update` events for real-time updates.
- **Worktree callout**: when workspace is on a worktree (detected from workspace descriptor),
  show a callout banner: "Working on branch X in a worktree". Actions: "Switch to main",
  "Delete worktree" (with confirmation → `git.worktree.delete` RPC).
- **Git notifications**: toast notifications for:
  - Push success: "Pushed N commits to origin/branch"
  - Pull with new commits: "Pulled N new commits"
  - Conflict detected: "Merge conflict in N files" (with action to open Changes tab)
  - Worktree created: "Worktree created at /path"
- **Workspace file-change subscriber**: when agent writes files, the checkout status may change
  (clean → dirty). Subscribe to file-write events → invalidate git status cache.
- **Stale branch indicator**: if branch is > 7 days behind upstream, show a subtle warning.

## Acceptance criteria
- [ ] Header badge shows real branch + status; updates in real-time on file changes.
- [ ] Worktree callout appears for worktree workspaces; actions work.
- [ ] Git notifications fire for push/pull/conflict/worktree events.
- [ ] File writes invalidate git status (clean → dirty transition).

## Test / verification plan
- Status: mock various git states → verify badge rendering.
- Worktree: mock worktree descriptor → verify callout; click delete → verify RPC.
- Notifications: emit push event → verify toast content.
- File write: emit file-write event → verify status refetch.
