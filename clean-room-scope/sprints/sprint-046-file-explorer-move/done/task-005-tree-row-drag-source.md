# Task 005 — Draggable explorer rows: drag source + drop-target highlight style

- **Sprint:** sprint-046-file-explorer-move
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** none

## Goal
Make file and directory rows draggable with an internal-drag payload the panel can recognise, and add
the row highlight style the drop logic will switch on. No drop is accepted yet.

## Background / why
`FileExplorer.tsx` already runs a **native HTML5** drop zone for OS-file uploads (`onDragOver` /
`onDrop` on the panel container). Internal moves extend that same mechanism with a custom MIME type
rather than introducing dnd-kit into the tree: dnd-kit is used in `features/workspace/TabStrip.tsx`
for **reordering a flat list**, which is a different problem from re-parenting into a tree — it would
need a `DndContext` plus a `useDroppable` per rendered row, inside a virtualized scroller, and would
still not interoperate with the OS-file drag already handled here.

The MIME type discriminates internal drags from OS-file drags, because `dataTransfer` exposes the
*type list* during `dragover` but not the *value* (protected mode).

## Scope references
- `clean-room-scope/features/file-explorer-move.md` § UI Behavior (drag a row; drop highlight)

## What to build
**Modify `packages/web-client/src/features/files/TreeNode.tsx`** — on the `styles.item` div in the
`file`/`directory` branch only (the loading/error/draft early-returns stay untouched) add `draggable`,
`onDragStart`, and a highlight class hook. New props appended to `TreeNodeProps`:

```ts
/** True while an internal drag would land in this row (`FileExplorer.tsx`'s hovered target). */
dropTarget?: boolean;
onDragStartRow(path: string, e: React.DragEvent): void;
```

Wire `onDragStart={(e) => onDragStartRow(row.path, e)}`, and the className becomes
`clsx(styles.item, active && styles.active, selected && styles.selected, dropTarget && styles.dropTarget)`.
Nothing else about the row changes — `onClick` / `onContextMenu` keep working (HTML5 drag does not
synthesize a click).

**Modify `packages/web-client/src/features/files/FileExplorer.module.css`** — add next to the existing
`.item.selected` rule, reusing the accent token `.draftInput`'s border already uses:

```css
.item.dropTarget {
  background: var(--pi-color-surfaceSunken, #111);
  box-shadow: inset 0 0 0 1px var(--pi-color-accent, #2e5cb8);
  border-radius: 0;
}
```

**Modify `packages/web-client/src/features/files/FileExplorer.tsx`** — add the module constant and the
drag-source handler, and pass it to every `TreeNode`:

```ts
const MOVE_MIME = "application/x-pi-studio-path";

function handleDragStartRow(path: string, e: DragEvent) {
  e.dataTransfer.setData(MOVE_MIME, path);
  e.dataTransfer.effectAllowed = "move";
  dragSourceRef.current = path;   // useRef<string | null>
}
```

`dragSourceRef` exists because `dataTransfer.getData()` returns `""` during `dragover`/`dragenter` in
every browser, so target validation needs the source path held in a ref. Clear it in `onDragEnd` on
the same row handler set.

## Out of scope
- Accepting the drop, resolving targets, auto-expand, and issuing the move (task-006).
- Any change to the existing OS-file upload path.

## Acceptance criteria
- [ ] Dragging a file or directory row starts an HTML5 drag whose `dataTransfer.types` includes
      `application/x-pi-studio-path` and whose `effectAllowed` is `move`.
- [ ] `dragSourceRef` holds the dragged path for the duration of the drag and is `null` after
      `dragend`.
- [ ] Loading, error, and draft rows are **not** draggable.
- [ ] Clicking a row still opens it and right-clicking still opens the context menu (no regression
      from adding `draggable`).
- [ ] A row rendered with `dropTarget` shows the inset accent outline; without it, rendering is
      byte-identical to before.
- [ ] Dragging an OS file into the panel still shows the "Drop to upload" overlay and uploads.

## Test / verification plan
- Build: `npm run build:web-client` and `npm run typecheck` pass.
- Suite: `npx vitest run packages/web-client` — no existing test regresses (there is no jsdom
  environment, so drag behavior itself is verified manually).
- Manual (`npm run dev:daemon` in one shell, `npm run dev -w @av-pi-studio/web-client` in another,
  open the Files panel on any workspace):
  - Start dragging a file row → the cursor shows a move affordance and no "Drop to upload" overlay
    appears (the container's `dragover` guard still only accepts `Files`, so the internal drag is not
    yet a valid drop).
  - Release anywhere → nothing happens, no console error.
  - Click a row → it opens. Right-click a row → context menu appears.
  - Drag a file from the OS file manager onto the panel → overlay appears, upload completes.

## Notes
- Keep `MOVE_MIME` a module constant in `FileExplorer.tsx`; task-006 reads it from the same module.
- Lowercase MIME string matters: browsers normalize `dataTransfer` type keys to lowercase, so
  comparisons elsewhere must use the same literal.
