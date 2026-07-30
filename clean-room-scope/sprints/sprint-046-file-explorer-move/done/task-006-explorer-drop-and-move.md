# Task 006 — Accept the drop: hover targeting, auto-expand, move + refresh

- **Sprint:** sprint-046-file-explorer-move
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-002, task-003, task-004, task-005

## Goal
Close the loop: an internal drag highlights its legal landing row, auto-expands a hovered collapsed
folder, and on release performs the move and refreshes both affected directories, the tree state, and
any open tab.

## Scope references
- `clean-room-scope/features/file-explorer-move.md` § UI Behavior (all bullets), § Behavior &
  Algorithms (live updates), § Error Handling & Edge Cases (status-line reporting)
- `clean-room-scope/features/file-explorer-transfer.md` § Live Directory & File Watching

## What to build
All changes in `packages/web-client/src/features/files/FileExplorer.tsx` unless noted.

**a. Drop target on row enter.** Replace the row wrapper's current
`onDragEnter={() => { if (row.kind === "directory") setDropTargetDir(row.path); }}` with a handler
serving both drag kinds:

```ts
onDragEnter={() => {
  const source = dragSourceRef.current;
  if (source) {
    const target = resolveMoveTarget(source, row, rootPath);
    setDropTargetDir(target?.destinationDir ?? null);
    setDropTargetRowPath(target ? row.path : null);
    scheduleAutoExpand(row);
    return;
  }
  // OS-file upload drag: a file row now targets its parent directory instead of falling back
  // to rootPath.
  if (row.kind === "directory") setDropTargetDir(row.path);
  else if (row.kind === "file") setDropTargetDir(dirOf(row.path));
}}
```

`dropTargetRowPath` is a new `useState<string | null>` used only to pass `dropTarget` down to the
matching `TreeNode` — the highlighted row is the row *hovered*, which for a file row differs from
`dropTargetDir`. Clear both on the container's `onDragLeave` and after any drop.

**b. Container `dragover` guard.** `handleDragOver` currently early-returns unless
`e.dataTransfer.types.includes("Files")`. Accept either kind and set the effect:

```ts
const isMove = e.dataTransfer.types.includes(MOVE_MIME);
if (!isMove && !e.dataTransfer.types.includes("Files")) return;
e.preventDefault();
e.dataTransfer.dropEffect = isMove ? "move" : "copy";
setDragging(!isMove);   // the "Drop to upload" overlay must NOT appear for internal moves
```

**c. Auto-expand on hover.** `scheduleAutoExpand(row)` — hovering a collapsed directory mid-drag
expands it after **700 ms** so the user can drill in without releasing. Implementation: a
`useRef<{ path: string; timer: number } | null>`; on entering a *different* row, `clearTimeout` the
pending one and, when `row.kind === "directory" && !row.expanded`, start a new
`setTimeout(() => toggle(row.path), 700)`. Clear it in `handleDrop`, in the container's `onDragLeave`,
and on unmount.

**d. Drop → move.** In `handleDrop`, branch **before** the existing upload path:

```ts
const source = e.dataTransfer.getData(MOVE_MIME) || dragSourceRef.current;
if (source) { void moveDropped(source, row); return; }
```

`moveDropped(source, row)` re-resolves the target with `resolveMoveTarget` against the row actually
dropped on — never trust the hover state — and on `null` returns silently (no status, no request).
Otherwise, in order:

1. `setStatus({ text: `Moving ${basename}…`, error: false })`
2. `await moveEntry(client, source, target.destination)` (task-002)
3. Invalidate exactly the two affected listings — **not** the broad `["explorer"]` key that
   `FileContextMenu`'s delete uses:
   `await queryClient.invalidateQueries({ queryKey: rpcKeys.explorer(dirOf(source)) })` and the same
   for `target.destinationDir`.
4. `useExplorerStore.getState().repathAfterMove(source, target.destination, target.destinationDir)`
   (task-004).
5. Tabs — tab ids embed the path (`tabIds.file(path)`), so a tab cannot be repathed in place;
   reopening is the honest move:
   ```ts
   const hadTab = useTabStore.getState().tabs.some(
     (t) => (t.kind === "file" || t.kind === "molecule") &&
            (t.data as FileTabData | MoleculeTabData).path === source);
   ```
   then `useTabStore.getState().closeByPathPrefix(source)` and, if `hadTab`,
   `openFileTab(target.destination, activeWorkspaceCwd || "~")`. For a moved **directory**, descendant
   tabs are closed and not reopened.
6. `setStatus({ text: `Moved to ${target.destinationDir.split("/").pop() || "/"}`, error: false })`
7. `catch` → `setStatus({ text: err instanceof Error ? err.message : "Failed to move", error: true })`
   — the existing `styles.statusError` row renders this. No new UI surface and no `window.alert`: that
   pattern belongs to `FileContextMenu`'s modal-ish actions, while the explorer body already owns a
   status line.

Also clear `dragSourceRef`, `dropTargetDir`, `dropTargetRowPath`, and the auto-expand timer in
`handleDrop` regardless of which branch ran.

**No optimistic tree update.** Invalidate-then-refetch is what create/delete/upload already do here,
and `useExplorerWatch` independently invalidates the same two directories when the daemon's
`file_changed` pushes land (payload is `{ type: "file_changed", path }` for the *watched directory*, so
both sides of a move notify). A duplicate refetch of an already-invalidated query is deduped by
TanStack Query; an optimistic layer on top would be a genuine double-update risk.

## Out of scope
- A context-menu Rename item and cut/copy/paste — the daemon primitive already supports rename via a
  same-parent destination, but no UI affordance is added here.
- Multi-select drag (one row per drag).
- Dragging rows **out** of the panel (to the OS or to another app).

## Acceptance criteria
- [ ] Dragging a file row onto a directory row moves the file into it; both directories' listings
      refresh with no manual reload.
- [ ] Dragging onto a **file** row moves into that file's parent directory.
- [ ] Dragging a directory with nested contents moves the whole subtree, and its previously expanded
      descendants remain expanded at the new location.
- [ ] Hovering a collapsed directory for ~700 ms mid-drag expands it; leaving earlier does not.
- [ ] Illegal drops (onto itself, into its own descendant, into the folder it already lives in,
      outside the root) show no highlight and do nothing on release — no request, no status text.
- [ ] A name collision leaves both files on disk and shows "An item with that name already exists in
      the destination folder." in the error status style.
- [ ] An open tab for a moved **file** reappears pointing at the new path; tabs under a moved
      **directory** close and do not reopen.
- [ ] The "Drop to upload" overlay never appears during an internal drag, and OS-file upload still
      works unchanged.

## Test / verification plan
- Build: `npm run build:web-client` and `npm run typecheck` pass.
- Suite: `npx vitest run packages/web-client` — all green.
- **End-to-end over the real wire (the primary proof).** Fixture:
  ```bash
  mkdir -p /tmp/pi-move-test/src/sub && printf 'hello\n' > /tmp/pi-move-test/note.txt
  printf 'deep\n' > /tmp/pi-move-test/src/sub/deep.txt
  ```
  Run `npm run build:server && npm run dev:daemon` in one shell and
  `npm run dev -w @av-pi-studio/web-client` in another; open the workspace at `/tmp/pi-move-test` and
  the Files panel. Then:
  - Drag `note.txt` onto the `src` row → status line reads `Moved to src`, the row disappears from the
    root and appears under `src`; `ls /tmp/pi-move-test/src/note.txt` succeeds.
  - Expand `src/sub`, drag `sub` to the root → `sub` and its expanded state land at the root and
    `deep.txt` is still readable.
  - Drag `note.txt` onto the row it already lives beside → nothing happens, no status text.
  - Drag `src` onto `src/sub` → no highlight, release does nothing.
  - Hover a collapsed directory mid-drag for ~1 s without releasing → it auto-expands.
  - Collision: `cp /tmp/pi-move-test/src/note.txt /tmp/pi-move-test/note.txt`, then drag the root
    `note.txt` onto `src` → red status line with the `exists` sentence, and **both** files still exist.
  - Open `note.txt` in a tab, move it → the tab reappears at the new path.
  - Drag an OS file from the desktop into the panel → "Drop to upload" overlay appears and the upload
    completes (regression check on the shared handlers).

## Notes
- Re-resolving the target on drop (not reusing hover state) matters: the pointer can leave the
  highlighted row before release, and the daemon would then receive a destination the user did not aim
  at.
- If HTML5 drag turns out to misbehave inside the virtualized scroller — the symptom is `dragenter`
  never firing on rows — the fallback is a `DndContext` in `FileExplorer.tsx` with `useDroppable` per
  rendered row and `useDraggable` in `TreeNode`, copying `features/workspace/TabStrip.tsx`'s
  sensor/collision setup but **without** `SortableContext`. Tasks 001–004 are unaffected by that swap.
