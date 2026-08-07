# Task 004 — Drag-a-tab-to-split: single drag context, drop regions, preview

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** in_progress
- **Type:** feature
- **Area:** web-client / workspace
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003

## Goal
One drag gesture spans every pane's strip and body: reorder within a strip, move to another strip,
and split by dropping on a body edge — with a live preview that always shows exactly what the drop
will do, including depth/degradation.

## Context / why
The spec's external dependency is explicit: a single gesture cannot begin in one drag system and
finish in another. Today each `TabStrip` owns a private dnd-kit `DndContext`
(`TabStrip.tsx:9–20`); this task lifts ONE `DndContext` above all panes and registers pane bodies
as droppables alongside the sortable strips.

The degradation rule is the part to get right: the gesture layer never presents an invalid split.
When `canSplit` is false for the resolved edge region, the region degrades to `center` — preview
shows the whole-pane move highlight, drop performs the move. What the user sees is always what
happens.

## Scope references
- `clean-room-scope/features/workspace-split-panes.md` § Drop regions, § Resolving a drop region,
  § Splitting (gesture-layer paragraph), § Error Handling & Edge Cases, § UI Behavior
- Modify: `packages/web-client/src/features/workspace/TabStrip.tsx` (remove per-strip `DndContext`;
  keep `SortableContext` per strip)
- Modify: `packages/web-client/src/features/workspace/TabPanelHost.tsx` or the pane chrome from
  task-003 (register body droppables)
- Create: `packages/web-client/src/features/workspace/pane-dnd.ts` (region resolution — pure)
- Create: `packages/web-client/src/features/workspace/DropPreview.tsx` (+ module CSS)
- Create: `packages/web-client/src/features/workspace/pane-dnd.test.ts`

## What to build
- **`pane-dnd.ts`** (pure, unit-tested):
  ```ts
  export const CENTER_BAND = 0.25;
  export type DropRegion = SplitRegion | "center";
  export function resolveDropRegion(
    pointer: { x: number; y: number }, bodyRect: DOMRectReadOnly,
  ): DropRegion;   // spec pseudocode: normalized dx/dy, center band, axis tie -> horizontal
  /** Degrades an edge region to "center" when canSplit is false. */
  export function effectiveDropRegion(
    tree: PaneNode, paneId: string, region: DropRegion,
  ): DropRegion;
  ```
- **One `DndContext`** wrapping all panes (strips + bodies). Strips keep their `SortableContext`;
  bodies become droppables carrying `paneId`. A floating drag-overlay chip shows the dragged tab's
  icon+label (dnd-kit `DragOverlay`).
- **Over a body**: track pointer position, resolve `effectiveDropRegion`, render `DropPreview` —
  the half of the pane the new pane would occupy for an edge region, the whole pane for `center`.
- **Drop dispatch**:
  - body + edge region → `layout-store.splitWithTab`;
  - body + `center`, or another pane's strip (not on a tab) → `layout-store.moveTab` (append last);
  - on a tab in another pane's strip → `moveTab` + `tab-store.reorder` to that position;
  - same-strip on a tab → existing reorder path unchanged;
  - released outside any target → no change;
  - dragged tab is the target pane's only tab and target = source → no-op (no preview flash:
    suppress the split preview for this case too).
- Keep the existing `PointerSensor` activation constraint so plain clicks still activate tabs.

## Out of scope
- Split buttons/menus and keyboard affordances (task-005).
- Touch/mobile drag support (per `workspace-ui.md`, no pane splits on phone).

## Acceptance criteria
- [ ] `resolveDropRegion` unit tests: center band (|dx|,|dy| < 0.25 → center), four edge zones,
      axis tie → horizontal, corner cases at exactly ±0.25.
- [ ] `effectiveDropRegion` degrades a perpendicular edge to `center` at depth 4 and leaves a
      same-direction edge intact (uses `canSplit` — no duplicated depth logic).
- [ ] Dropping a tab on each of the four edges of another pane's body splits in the matching
      direction with the dragged tab active in the new pane on the dropped side.
- [ ] Dropping in the central band moves the tab into the pane without splitting.
- [ ] The preview always matches the outcome: half-pane highlight for a split, whole-pane for
      center/degraded, nothing for no-op drops.
- [ ] Reorder within a strip and cross-strip tab drops land at the expected positions.
- [ ] A drag released over no target changes nothing.
- [ ] During a drag that creates a split, a terminal streaming output in another pane keeps
      streaming (manual check; the store-level guarantee is sprint-048's).

## Test / verification plan
- Tests: `pane-dnd.test.ts` covers both pure functions exhaustively (this is where the geometry
  math lives — component wiring is thin). Run
  `npx vitest run packages/web-client/src/features/workspace/pane-dnd.test.ts` plus the workspace
  suite.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Manual: drag tabs across three panes — every edge, center, strip, tab, outside; verify preview
  fidelity and that a live terminal never blinks during rearrangement.

## Notes
- dnd-kit collision: strips need sortable collision while bodies need pointer-position hit-testing;
  a custom `collisionDetection` combining `pointerWithin` (bodies) with `closestCenter` (strip
  items) is the expected shape — keep `NewTabMenu` outside the sortable context as today
  (`TabStrip.tsx:85–89`).
- The drop preview is chrome, not a panel: render it in the overlay layer with the dividers, never
  inside a panel (it must not affect panel mounting).
