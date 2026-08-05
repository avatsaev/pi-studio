# Task 004 — Drag-to-split source wiring for links and images

- **Sprint:** sprint-051-file-link-rendering
- \*\*Status:\*\* done
- **Estimated size:** S
- **Depends on:** task-003

## Goal
Make a rendered local `FileLink` (and, by the same fix, a resolved `InlineImage`) a native-HTML5
drag source carrying the existing `EXTERNAL_DRAG_MIME.path` payload, so dragging either onto a
pane's edge splits and opens it, exactly like a Files-tree row drag.

## Background / why
`file-link-rendering.md` § Drag-to-split: the rendered element is a drag source carrying the
identical payload `workspace-split-panes.md` § Drag sources already defines for a Files-tree row —
the target's absolute path, under the existing `path` kind. No new payload kind, no new drop
region, no new drop-resolution logic: `use-external-pane-drop.ts`'s `applyExternalDrop` already
handles the `path` kind end-to-end once a source writes the MIME. An external (non-local) link or a
remote image is never a drag source for this payload — it falls back to the browser's own default
drag behavior.

The pattern to replicate is the Files tree's: `TreeNode.tsx` sets `draggable` +
`onDragStart={(e) => onDragStartRow(row.path, isDirectory, e)}`, which calls
`FileExplorer.tsx:155-157`'s handler doing `e.dataTransfer.setData(EXTERNAL_DRAG_MIME.path, path)`
(only when not a directory) and `e.dataTransfer.effectAllowed = "copyMove"`.

Per the spec's Known Limitations, a directory-target link is knowingly **not** guarded against
here — there is no existence/type pre-check before drag or click, so a directory link stays
draggable and a drop fills the new split with the viewer's non-file state, which is accepted.

## Scope references
- `clean-room-scope/features/file-link-rendering.md` § Drag-to-split, § Error Handling & Edge
  Cases (drag rows), § Known Limitations (directory drag-source note)
- `clean-room-scope/features/workspace-split-panes.md` § Drag sources
- `packages/web-client/src/features/workspace/external-drag.ts` (`EXTERNAL_DRAG_MIME`)
- `packages/web-client/src/features/files/FileExplorer.tsx:146-158` (pattern to mirror)
- `packages/web-client/src/hooks/use-external-pane-drop.ts` (drop side — unchanged, verify only)
- `packages/web-client/src/timeline/FileLink.tsx`, `InlineImage.tsx` (task-003 output)

## What to build
- `FileLink.tsx`: for a `local` classification, add `draggable` and `onDragStart` calling
  `e.dataTransfer.setData(EXTERNAL_DRAG_MIME.path, path)` + `e.dataTransfer.effectAllowed =
  "copyMove"`. `external` renders the untouched default `<a>` with no drag wiring added.
- `InlineImage.tsx`: same treatment on the `<img>` for a resolved (`ready`) local image, writing the
  identical payload for `view.path`. A remote image gets no added drag wiring.
- No changes to `pane-dnd.ts`, `external-drag.ts`, or `use-external-pane-drop.ts` — confirm by
  reading them (already generic over the `path` kind) rather than modifying them.

## Out of scope
- Any drop-side, drop-region, or payload-registry change.
- Guarding against dragging a directory-target link — accepted gap per Known Limitations.

## Acceptance criteria
- [ ] Dragging an actionable file link onto a pane's edge splits that pane and opens the file into
      the new split, identical to dragging the same path from the Files tree.
- [ ] Dragging onto a pane's center region opens/moves into that pane without splitting.
- [ ] Dragging an actionable file link that already has an open tab elsewhere reuses that tab
      (`use-external-pane-drop.ts`'s existing already-open path), no duplicate.
- [ ] Dragging a resolved inline image behaves identically to a file link for all three cases above.
- [ ] Dragging an `external` link or a remote image does not carry `EXTERNAL_DRAG_MIME.path` —
      `externalDragKind(event.dataTransfer.types)` returns `null` — and the browser's default
      link/image drag behavior applies unmodified.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint` pass.

## Test / verification plan
- Unit: assert `FileLink`'s (and `InlineImage`'s) `onDragStart` handler calls
  `dataTransfer.setData(EXTERNAL_DRAG_MIME.path, path)` with the normalized path for `local`, and
  does nothing for `external`/remote — following `use-external-pane-drop.test.ts`'s existing
  pattern of driving the pure logic directly rather than jsdom drag simulation.
- Run: `npx vitest run packages/web-client/src/timeline packages/web-client/src/hooks/use-external-pane-drop.test.ts`.
- Manual: drag a rendered file link from a chat message onto a pane's left/right/top/bottom edge and
  confirm a split opens the file; drag onto an existing pane's center and confirm it opens/moves
  there; drag a link whose file is already open elsewhere and confirm no duplicate tab appears.

## Notes
Do not reuse the Files tree's row-move MIME (`application/x-pi-studio-path`) — that is a different
outcome (row reorder) from an open-into-pane drag, deliberately distinguishable per
`external-drag.ts`'s own doc comment.
