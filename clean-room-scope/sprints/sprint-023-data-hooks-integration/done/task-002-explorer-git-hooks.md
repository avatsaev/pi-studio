# Task 002 — File explorer & git data hooks

- **Sprint:** sprint-023-data-hooks-integration
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001; sprint-009 (file/terminal server), sprint-008 (git)

## Goal
Build React Query hooks for the file explorer (directory listing, file read) and git panel
(status, diff, branches, PR data) so the sprint-022 panel components can render real data.

## Scope references
- `clean-room-scope/features/file-explorer-transfer.md`
- `clean-room-scope/features/git-checkout.md`

## What to build
- **Explorer hooks**: `useDirectoryListing(serverId, path)` → lazy-fetch children on expand;
  `useFileContent(serverId, path)` → fetch file for preview; `useDownloadToken(serverId, path)` →
  request a download token.
- **Git hooks**: `useGitStatus(serverId, cwd)` → changed files; `useGitDiff(serverId, cwd, file)` →
  unified/split diff; `useGitBranches(serverId, cwd)` → branch list; `useGitActions(serverId, cwd)` →
  available actions (commit, push, pull, stash); `usePrActivityQuery(serverId, cwd)` → PR feed.
- **Mutation hooks**: `useGitCommit()`, `useGitCheckout()`, `useGitPush()`, `useGitStash()`.
- **Cache invalidation**: refetch git status after mutations; invalidate explorer after file writes
  (subscribe to agent file-write events).

## Acceptance criteria
- [ ] Explorer lazily fetches directories and renders the tree from real data.
- [ ] File preview fetches and displays content (code/markdown/image) from the daemon.
- [ ] Git hooks fetch status/diff/branches/PR and invalidate on mutations.

## Test / verification plan
- Mock client responses → verify hook return values and loading/error states.
- Cache invalidation: simulate file-write event → verify explorer refetch triggered.
