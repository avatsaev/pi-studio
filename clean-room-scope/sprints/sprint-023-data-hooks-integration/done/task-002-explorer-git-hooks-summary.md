# Task 002 — File Explorer & Git Data Hooks — Summary

- **Sprint:** sprint-023-data-hooks-integration
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

React Query hooks for all file explorer and git panel data operations, ready to be consumed by the
Explorer, FilePreviewPane, GitChangesPanel, and PrActivityPanel components from sprint-022.

### Files created
| File | Description |
|------|-------------|
| `packages/app/src/hooks/use-explorer-hooks.ts` | Directory listing, file content, download token, git status/diff/branches/PR hooks + git mutation hooks + `subscribeFileWriteInvalidation` |
| `packages/app/src/hooks/use-explorer-hooks.test.ts` | 9 tests covering query keys, cache invalidation logic, unsubscribe |

## How it satisfies the scope

| Scope requirement | Implementation |
|---|---|
| `useDirectoryListing` — lazy-fetch on expand | `enabled: options.enabled ?? false` (tree lazily fetches when expanded) |
| `useFileContent` — file for preview | Queries `file_explorer_request` with serverId + path |
| `useDownloadToken` — one-time download token | `staleTime: 0, gcTime: 0` — never reuses cached token |
| `useGitStatus` — changed files | `checkout_status_request` RPC |
| `useGitDiff` — unified diff | `checkout_diff_request` RPC |
| `useGitBranches` — branch list | `git_branches_request` RPC |
| `usePrActivityQuery` — PR feed | `pull_request_timeline_request` RPC |
| Mutation hooks: commit, checkout, push, stash, stashPop | `useGitActions()` — returns all 5 mutations; each invalidates git cache on success |
| Cache invalidation on file writes | `subscribeFileWriteInvalidation` — listens for `tool_call` events with `kind: edit/write` → invalidates `git/status` and `explorer/dir` queries |

## Build & test results

```
$ npx tsc -b packages/app
(no errors)

$ npm test -- packages/app/src/hooks/use-explorer-hooks.test.ts
Test Files  1 passed (1)
Tests  9 passed (9)

$ npm test
Test Files  100 passed (100)
Tests  1367 passed (1367)
```

## Acceptance criteria
- [x] Explorer lazily fetches directories — `enabled` option controls fetch activation
- [x] File preview fetches content from daemon — `useFileContent` hook
- [x] Git hooks fetch status/diff/branches/PR and invalidate on mutations — all implemented with proper `onSuccess` cache invalidation
- [x] Cache invalidation on file-write events — `subscribeFileWriteInvalidation` verified by tests

## Follow-ups / TODO(verify)
- `file_explorer_request` RPC name must be confirmed — may be split into separate directory/file RPCs on the server.
- `checkout_status_request` may come as a subscription (`checkout_status_update`) rather than a one-shot request; if so, hook needs to switch to subscription model.
- Git diff: server may require `staged: boolean` parameter to distinguish staged vs unstaged diffs.
