# Task 005 Summary — Draggable explorer rows: drag source + drop-target highlight style

## What was built
- `TreeNode.tsx`: the `file`/`directory` row div is now `draggable`, wires `onDragStart={(e) =>
  onDragStartRow(row.path, e)}`, and gains a `dropTarget && styles.dropTarget` class term. Two new
  props: `dropTarget?: boolean` and `onDragStartRow(path, e: DragEvent): void`. Loading/error/draft
  rows return early before this div and are unaffected (not draggable).
- One divergence from the task's literal prop list, called out for the record: I also added
  `onDragEndRow(): void` and wired it to the row's `onDragEnd`. The task only lists
  `onDragStartRow`, but its own acceptance criterion ("`dragSourceRef` … is `null` after
  `dragend`") requires *something* to clear the ref, and `dragend` fires on the row that started
  the drag — the row component is the only thing that can attach that handler. `onDragEndRow` is
  the minimal, symmetrical way to satisfy that criterion without smuggling ref access into
  `TreeNode`.
- `FileExplorer.module.css`: added `.item.dropTarget` next to `.item.selected`, reusing the accent
  token.
- `FileExplorer.tsx`: added the `MOVE_MIME` module constant, a `dragSourceRef` (`useRef<string |
  null>`), `handleDragStartRow`/`handleDragEndRow`, and passed `onDragStartRow`/`onDragEndRow` to
  every rendered `TreeNode` (`dropTarget` is not yet wired — task-006's job).

## Files changed
- `packages/web-client/src/features/files/TreeNode.tsx`
- `packages/web-client/src/features/files/FileExplorer.module.css`
- `packages/web-client/src/features/files/FileExplorer.tsx`

## Commands run + results
- `npm run build:web-client` → clean.
- `npm run typecheck` → clean.
- `npx vitest run packages/web-client` → 300/300 passed, no regressions (no jsdom environment, so
  drag behavior itself is not exercised by the automated suite, per the task's own test plan).
- `npx oxlint <changed files>` → clean.
- `npx oxfmt --check` → clean (server files touched by task-001 needed one auto-fix pass; the
  web-client files from this task were already formatted).

## Acceptance criteria status
- Automated: no existing test regressed; loading/error/draft rows structurally cannot reach the
  draggable div (early return).
- Manual (not run by me — deferred to the user's live smoke test per this session's instruction):
  drag-start MIME/effectAllowed, `dragSourceRef` lifecycle, click/context-menu regression check,
  `dropTarget` visual, and the OS-file-upload regression check.

## Notes / follow-ups
- `dropTargetDir`'s existing `onDragEnter` on the row wrapper is untouched by this task (still only
  reacts to `row.kind === "directory"`) — task-006 replaces it with the full hover-targeting logic
  using `resolveMoveTarget`.
