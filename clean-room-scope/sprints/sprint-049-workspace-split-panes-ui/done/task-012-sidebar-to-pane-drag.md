# Task 012 — Open a new pane by dragging a chat or a file out of a sidebar

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done — user-verified live
- **Type:** feature
- **Depends on:** task-004 (drop regions), task-005 (`splitEmpty` + targeted opens)
- **Size:** M

## Why

Requested: the only way into a split was dragging a tab that was *already* open. Opening a second
conversation side by side meant click the row, then drag its tab — two gestures for one intent.

The expensive parts already existed, which is what made this small: `pane-dnd`'s region resolution is
pure and takes a pointer plus a rect (it does not care what produced the pointer), `layout-store`
already had `splitEmpty(cwd, pane, region) → newPaneId` from the Split right/down buttons, and
`tab-store.open(tab, targetPaneId)` already accepted a target. A drop is those last two composed.

## Change

**Native HTML5 DnD, not dnd-kit — forced, not stylistic.** dnd-kit cannot receive an OS file drop
(`dataTransfer.files` exists only in native DnD), and the file tree depends on that for uploads, so
those rows must stay native drag sources regardless; arming dnd-kit on them too would start two
gestures on one pointer-down. Native also avoids hoisting `DndContext` above both sidebars. The two
systems cannot collide: a native `dragstart` suppresses the pointer events `PointerSensor` needs.

1. **`features/workspace/external-drag.ts`** (new, pure) — one MIME per dragged kind
   (`…-open-chat`, `…-open-path`), payload decode, and `resolveExternalDropRegion` sharing
   `effectiveDropRegion` so a sidebar preview degrades identically to a strip drag's. Mid-drag a
   browser exposes `dataTransfer.types` but not the values, so the *type name* carries the kind — the
   pattern the file tree already documents for move-vs-upload.
2. **`pane-dnd.ts`** — added `containsPoint`; a native drag must find its own pane, dnd-kit does not.
3. **`hooks/use-external-pane-drop.ts`** (new) — host-level `dragover`/`dragleave`/`drop`, one preview
   slot shared with the dnd-kit path, and `applyExternalDrop` (exported for direct unit testing, the
   `use-terminal-restore.ts` convention). Pane bodies are located by **measuring** the
   `data-pane-drop` zones: the box is a percentage rect minus `var(--pane-strip-height)`, and the DOM
   is the only place those are already combined, so recomputing it would be a second geometry.
   Listeners sit on the host because the zones are `pointer-events: none`.
4. **Drag sources** — session rows (`SessionList`/`SessionItem`) and file rows (`FileExplorer`
   `handleDragStartRow`, now told `isDirectory`). A file row carries its move MIME *and* its open MIME:
   one gesture, and where it lands picks the meaning.
5. **`features/sessions/open-chat-tab.ts`** (new) — the chat-tab literal had been copied into three
   places (sidebar click, connect-time restore, and now this); since `tabIdentity` keys the persisted
   layout off it, a fourth copy was a fourth chance to drift. All three now call one helper.
   `openFileTab`/`openMoleculeTab` gained the optional `targetPaneId` they were missing.

Two restrictions live at the *source*, not the drop: a row from another workspace, and a directory row,
withhold the open MIME entirely. A pane cannot read a payload mid-drag, so refusing at drop time would
have previewed an outcome that then did not happen.

## Acceptance

- [x] Dragging a conversation row onto a pane edge splits it and opens that chat in the **new** pane;
      onto the centre opens it in the dropped-on pane.
- [x] Dragging a file row does the same, picking file-vs-molecule through the shared `openFileTab`
      dispatch, so a dragged path and a clicked row can never open different panels.
- [x] A payload that already has a tab moves/splits **that** tab — no duplicate — and inherits the
      strip drag's no-op rules exactly.
- [x] A row outside the workspace in view, a directory row, and an OS file drag are all inert over a
      pane; the file tree's own row-move and upload behaviour is unchanged.
- [x] An illegal edge degrades to `center` in the preview and the drop, from one shared resolution.
- [x] **Live:** dragging a second conversation onto the right edge of a single pane produced two panes
      (550px each), the dropped chat active in the new right pane with its real history streamed.
- [ ] **Live:** the file→pane leg was not exercised; the chat→pane leg was. Same code path past
      `readExternalDrag` (one shared region resolution and dispatch), and covered by unit tests.

## Verification

- 20 new tests: 10 in `features/workspace/external-drag.test.ts` (transport + region degradation +
  `containsPoint`), 10 in `hooks/external-pane-drop.test.ts` (the dispatch: fresh open vs reuse,
  split-vs-centre, both no-op rules, missing session, molecule reuse).
- Full web-client suite **585 passing** (47 files), up from 565 with no regressions — notably none from
  the `openChatTab` consolidation or the `TreeNode` callback signature change.
- `tsc -b --force` clean; `npm run build:web-client` ✓; `oxfmt --check` and `oxlint` clean on all 13
  touched files (zero new warnings).
- One fixture bug found and fixed while writing the tests: the first depth-cap case asserted
  degradation on a *sibling insert*, which is always legal — corrected to a nesting split, and it now
  pins both `canSplit` branches.
