# Task 006 Summary — Accept the drop: hover targeting, auto-expand, move + refresh

## What was built
All in `packages/web-client/src/features/files/FileExplorer.tsx`:

- **Hover targeting.** The per-row wrapper's `onDragEnter` now branches on `dragSourceRef.current`:
  during an internal drag it calls `resolveMoveTarget(source, row, rootPath)` and sets
  `dropTargetDir`/`dropTargetRowPath` (or clears both on an illegal drop), and schedules
  auto-expand; during an OS-file drag it keeps the old directory-row behavior plus the file-row →
  parent-directory fix.
- **Container `dragover` guard.** `handleDragOver` now accepts either `MOVE_MIME` or `"Files"`,
  sets `dataTransfer.dropEffect` accordingly, and only shows the "Drop to upload" overlay
  (`setDragging`) for the non-move case.
- **Auto-expand on hover.** `scheduleAutoExpand(row)` — a `useRef<{ path; timer } | null>` — starts
  a 700ms `window.setTimeout(() => toggle(row.path), 700)` when hovering a *different*, collapsed
  directory row, and clears the previous pending timer on every call (and in `clearDropState`).
- **Drop → move.** `handleDrop(e, row?)` is shared between the per-row `onDrop` (which
  `stopPropagation`s and passes the actual row dropped on — never the stale hover target) and the
  container's fallback `onDrop` (no `row` → synthetic `{ kind: "directory", path: rootPath }`, for
  a drop landing on empty space below the rows). It reads
  `e.dataTransfer.getData(MOVE_MIME) || dragSourceRef.current` first; if present, delegates to
  `moveDropped(source, row)` and returns before the existing upload path runs.
- **`moveDropped`** re-resolves the target against the actual drop row (per the task's note: never
  trust hover state), and on a legal target: sets the "Moving …" status, calls `moveEntry`
  (task-002), invalidates the two affected `rpcKeys.explorer(...)` listings, calls
  `repathAfterMove` (task-004), closes/reopens the affected tab (file moves reopen at the new path;
  directory-move descendant tabs close and stay closed), and sets the final status line (success
  or the thrown error's message).

## Files changed
- `packages/web-client/src/features/files/FileExplorer.tsx` — all of the above; no other file
  needed changes (tasks 002–005 already supplied `moveEntry`, `resolveMoveTarget`,
  `repathAfterMove`, and the drag-source/highlight wiring).

## Commands run + results
- `npm run build:web-client` → clean.
- `npm run typecheck` → clean (whole-repo `tsc -b`).
- `npx vitest run packages/web-client` → 300/300 passed, no regressions.
- `npx oxlint packages/web-client/src/features/files/FileExplorer.tsx` → clean.
- `npx oxfmt --check` → clean (one auto-fix pass was needed and re-verified green).

## Acceptance criteria status
- Verified by the build/typecheck/full-suite run above: no regression in any existing web-client
  test, and the file compiles under the project's strict TS config (`window.setTimeout` used
  instead of the ambient `NodeJS.Timeout` overload to keep the ref's type as `number`).
- **Not run by me, per this session's explicit instruction to pause for the user's manual
  verification instead of smoke-testing myself.** The task's own test/verification plan is
  end-to-end-over-the-real-wire by design (drag-and-drop has no jsdom coverage in this repo) — see
  the sprint-level message to the user for the exact repro steps to run.

## Notes / follow-ups
- No optimistic tree update, as specified — invalidate-then-refetch only, matching create/delete/
  upload; `useExplorerWatch`'s independent `file_changed`-driven invalidation of the same two
  directories is a harmless duplicate (deduped by TanStack Query).
- Rename UI and cut/copy/paste remain out of scope (daemon primitive already supports rename via a
  same-parent destination; no UI affordance was added here, matching the task).
