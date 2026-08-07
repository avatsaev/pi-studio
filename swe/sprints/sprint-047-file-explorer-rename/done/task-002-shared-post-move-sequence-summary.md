# Task 002 — Extract + correct the shared post-move sequence (`applyMove`) — Summary

- **Sprint:** sprint-047-file-explorer-rename
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented

Extracted `moveDropped`'s inline post-move reconciliation into a new `applyMove(source,
requestedDestination)` helper in `FileExplorer.tsx`, closing over `client`, `queryClient`, and
`handleOpenFile` as the task specified (no new module — both callers live in this component).
Fixed the two defects while extracting:

1. **Destination echo honoured.** `applyMove` now uses `moveEntry`'s *returned* destination (and
   derives `destinationDir` from it via `dirOf`) for cache invalidation, `repathAfterMove`, and
   the reopen — not the client-computed `target.destination`. After task-001, the daemon may
   legitimately trim the destination; the client now follows that echo instead of repathing/
   reopening a path that no longer exists on disk.
2. **Closed diff tabs reported, not silent.** Before calling `closeByPathPrefix`, `applyMove`
   partitions the matching tabs using the exact same predicate `closeByPathPrefix` itself uses
   (`path === source || path?.startsWith(`${source}/`) ?? false`, across `file`/`diff`/
   `molecule` kinds) and counts the `diff` matches. `moveDropped` reports that count via the new
   pure `withClosedDiffs` formatter. Per the recorded decision in `features/file-explorer-
   improvements.md` § 9, diff tabs still close and do **not** reopen (a per-path `git diff`
   against the new path would render the whole file as additions) — only the silence was the bug.

`moveDropped` is now a thin wrapper: resolve the drop target, call `applyMove`, format the status
line with `withClosedDiffs`. Its `Moving <basename>…` leading status and the `catch` writing
`err.message` are unchanged, matching the task's "preserve observable behavior" requirement.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/files/move-status.ts` | created — pure `withClosedDiffs` formatter |
| `packages/web-client/src/features/files/move-status.test.ts` | created — 4 tests (0/1/2, immutability) |
| `packages/web-client/src/features/files/FileExplorer.tsx` | modified — added `applyMove`, rewrote `moveDropped`, added `DiffTabData`/`withClosedDiffs` imports |

## How it satisfies the scope

Implements sprint-047 task-002 against `clean-room-scope/features/file-explorer-improvements.md`
§ 9 (destination-echo caveat, Decision 2026-08-03 on diff-tab closing) and `clean-room-scope/
features/file-explorer-move.md` § UI Behavior (status line, tab reopen). One deviation from the
task's sketch, required by strict-null-checking: `MoleculeTabData.path` is `string | null`, so the
partition predicate uses `path?.startsWith(...) ?? false` (mirroring `tab-store.ts`'s own
`closeByPathPrefix` predicate verbatim) rather than a bare `path.startsWith(...)`, which `tsc`
correctly rejected (`TS18047`). No other deviation.

## Build & test results
```
$ npx vitest run packages/web-client/src/features/files/move-status.test.ts
Test Files  1 passed (1)
     Tests  4 passed (4)

$ npm run typecheck        # tsc -b, root
success (exit 0)

$ npm run build:web-client
VITE_TARGET=web tsc -b && VITE_TARGET=web vite build — success (exit 0)

$ npx oxlint packages/web-client/src/features/files/FileExplorer.tsx
$ npx oxfmt --check packages/web-client/src/features/files/FileExplorer.tsx
clean

$ npx vitest run packages/web-client/src/features/files/
Test Files  7 passed (7)
     Tests  63 passed (63)   # includes the 4 new move-status tests
```

## Acceptance criteria
- [x] `moveDropped` uses the destination returned by `moveEntry` — not its own computed one — for invalidation, `repathAfterMove`, and the reopen (`applyMove` binds `destination` from `moveEntry`'s return, `target.destination` is only the initial request)
- [x] Given a daemon that echoes a trimmed destination, when a move completes, then the trimmed path is repathed and reopened — `applyMove` derives `destinationDir`/reopen path from the echo, never from the caller's requested destination
- [x] Given an open diff tab on the moved path, when the move completes, then the tab is closed and the status line reports the count — verified by `move-status.test.ts`'s singular/plural cases plus the shared predicate in `applyMove`
- [x] `withClosedDiffs(text, 0) === text`; `1` renders `diff tab`; `2` renders `diff tabs` — 3 direct test cases
- [x] Diff tabs on descendants of a renamed/moved directory are counted — same prefix predicate as `closeByPathPrefix`, which already handles descendants
- [x] Drag-move behavior otherwise unchanged — exact-path `file`/`molecule` tabs still reopen (`hadTab` predicate preserved verbatim), both directories still invalidated, failures still write `err.message` — all pre-existing `move-target.test.ts` (13) and the rest of the files suite (63 total) still pass

## Follow-ups / TODO(verify)
- None. `applyMove` is unused by anything but `moveDropped` until task-005 adds the rename caller.
