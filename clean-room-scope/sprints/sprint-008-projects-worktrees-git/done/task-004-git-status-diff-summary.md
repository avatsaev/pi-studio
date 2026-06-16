# Task 004 — Git status/diff projections + streaming — Summary

- **Sprint:** sprint-008-projects-worktrees-git
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/projects/`:
- **`status-projection.ts`** — `parsePorcelainV2()` parses `git status --porcelain=v2 --branch`
  into `CheckoutStatusProjection` (`branch`, `upstream`, `ahead`/`behind`, `detached`,
  `staged`/`unstaged`/`untracked`/`conflicted`, `hasConflicts`). `projectStatus(cwd)` first checks
  `rev-parse --is-inside-work-tree`; detached/non-git reports `available:false` +
  `unavailableReason`.
- **`workspace-git-service.ts`** — `WorkspaceGitService`: `getStatus()`, `subscribe(cwd, listener)`
  (emits a snapshot immediately), and `refresh(cwd)` which recomputes and notifies **only when the
  projection changed** (serialized-dedupe). Change-driven (watcher calls `refresh`), never polled.
- **`checkout-diff-manager.ts`** — `CheckoutDiffManager`: `subscribe(request, emit)` streams
  `checkout_diff_update` (`git diff [--staged] [-- path]`) chunked (default 64KiB) with
  `chunk`/`totalChunks`/`done`; `unsubscribe()` stops mid-stream; `refresh()` re-streams.
- **`git-checkout-rpc.ts`** — `registerGitCheckoutHandlers()` wires `checkout_status_subscribe`/
  `_unsubscribe`, `checkout_diff_subscribe`/`_unsubscribe`, and (only when
  `features.checkoutRefresh` is advertised) `checkout_refresh_request`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/projects/status-projection.ts` | created |
| `packages/server/src/projects/workspace-git-service.ts` | created |
| `packages/server/src/projects/checkout-diff-manager.ts` | created |
| `packages/server/src/projects/git-checkout-rpc.ts` | created |
| `packages/server/src/projects/index.ts` | modified (re-exports) |
| `packages/server/src/projects/git-status.test.ts` | added — 7 tests (real temp git repo) |

## Build & test results
```
$ npm run build:server                                       → exit 0
$ npx vitest run packages/server/src/projects/git-status.test.ts → 7 passed
$ npx oxlint / oxfmt --check packages/server/src/projects     → clean
```

## Acceptance criteria
- [x] Status changes stream as `checkout_status_update` without polling (change-driven `refresh` +
      dedupe; subscribe emits a snapshot).
- [x] Diff subscribe yields `checkout_diff_update`; unsubscribe stops it.
- [x] Merge conflicts appear in the status projection (`hasConflicts` + `conflicted`).
- [x] Detached/non-git workspaces report git ops unavailable (`available:false`).

## Follow-ups / TODO(verify)
- Exact diff projection format/chunking (modeled as text chunks with chunk indices).
- Filesystem-watch wiring to call `refresh()` is left to bootstrap integration; the service is
  watch-agnostic (the watcher just invokes `refresh`).
