# Task 004 summary — Drag-a-tab-to-split: single drag context, drop regions, preview

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done
- **Completed:** 2026-08-03

## What was built

- **`features/workspace/pane-dnd.ts` (new, pure)** — `CENTER_BAND = 0.25`,
  `resolveDropRegion(pointer, body)` (normalized ±0.5 offsets, centre band, axis tie → horizontal),
  `effectiveDropRegion(tree, paneId, region)` (illegal edge → `center`, via `canSplit` — the depth
  rule is never duplicated), and `isNoOpDrop(region, paneId, tabId, placement)`.
- **`hooks/use-pane-drag.ts` (new)** — everything the one shared `DndContext` needs: sensors
  (unchanged 4px activation constraint, so a plain click still activates a tab), collision ranking,
  the live preview, and the drop dispatch. Three droppable kinds ranked `tab` → `strip` → `pane`
  (a tab is inside a strip, so `pointerWithin` matches both and the most specific wins). No target
  under the pointer → empty collisions → releasing changes nothing.
- **One `DndContext`** now wraps every strip and body, in `TabPanelHost`; `TabStrip` keeps only its
  `SortableContext` plus a strip-level droppable. Pane bodies register through `PaneDropZone`, a
  `pointer-events: none` box at the pane's body rect — dnd-kit hit-tests measured rects against
  pointer coordinates, so a drop zone needs a box but must not swallow clicks into the panel.
- **`DropPreview.tsx` + module CSS (new)** — the outcome preview (accent-tinted box) and the floating
  `DragChip` shown inside `DragOverlay`. Both are chrome in the overlay layer, never inside a panel.
- **`dropPreviewStyle(rect, region)`** in `pane-layout-view.ts` — the half of the pane **body** the new
  pane would occupy, or the whole body for `center`, in `calc()` percentages that account for the
  strip row.
- **Drop dispatch**: edge → `splitWithTab`; `center` → `moveTab` + a reorder past the receiving pane's
  last tab ("appended last"); another pane's strip → same as `center`; a tab in another pane →
  `moveTab` + `reorder` at that tab's position; same-strip tab → the existing reorder path, untouched.

**The preview cannot disagree with the drop**: `resolveTarget` computes one already-degraded region and
both the preview render and `onDragEnd` read it. `isNoOpDrop` returns `null`, which suppresses the
preview *and* the dispatch for the two no-op cases (a `center` drop into the tab's own pane, and
splitting a pane with its only tab).

## Files changed

| File | Change |
|---|---|
| `features/workspace/pane-dnd.ts` + `.test.ts` | **new** — region resolution, degradation, no-op detection; 17 tests |
| `hooks/use-pane-drag.ts` | **new** — the shared context's sensors, collisions, preview, dispatch |
| `features/workspace/DropPreview.tsx` + `.module.css` | **new** — outcome preview + drag chip |
| `features/workspace/pane-layout-view.ts` / `.test.ts` | `dropPreviewStyle` (+3 tests) |
| `features/workspace/TabStrip.tsx` | per-strip `DndContext` removed; strip droppable added; `ICON_BY_KIND` exported; sortables tagged `type: "tab"` |
| `features/workspace/TabPanelHost.tsx` | one `DndContext`, `PaneDropZone`s, `DropPreview`, `DragOverlay` |
| `features/workspace/TabPanelHost.module.css` | `.dropZone`; `.panel { overflow: hidden }` |

`.panel { overflow: hidden }` fixes a defect this sprint introduced: a pane is narrower than the host,
and viewers with a wide minimum content (molecule, code) painted over the neighbouring pane. Observed
in the browser, fixed, re-observed.

## Commands run

| Command | Result |
|---|---|
| `npx vitest run .../pane-dnd.test.ts` | **17 passed** |
| `npx vitest run packages/web-client` | **43 files, 522 passed** |
| `npm run build:web-client` | ✅ built in 7.50s |
| `npx oxlint` (workspace + the new hook) | ✅ no warnings |
| `npx oxfmt` (20 files) | ✅ formatted |

## Live verification (headless Chromium, real mouse drags)

| Drag | Preview during drag | Result on release |
|---|---|---|
| tab → **right edge** of the only pane's body | right half: `x=670 w=450 h=781` (body is `220..1120 × 84..865`) | `row` split; dragged tab alone in the new right pane, focused + active |
| tab → **centre** of the other pane's body | whole body: `x=220 w=450 h=781` | moved into that pane; emptied pane collapsed to a single leaf; tab appended last |
| tab → other pane's **strip**, right of its last tab | whole target pane | moved into that pane, appended last (`[Molecule 2, New chat]`) |
| tab → **a tab** in the other pane | (sortable) | moved into that pane at that tab's position (`[New chat, Molecule 1]`) |
| a pane's **only** tab → that same pane's edge | **none** | nothing changed (tree, placement, order all identical) |
| released over the **sessions sidebar** | **none** | nothing changed |
| tab → **bottom edge** of a depth-4 pane in a `row` run | whole body `895,491 225×374` (not the bottom half) | **degraded to a move**: tab landed *in* that pane, leaf count stayed 4 — no fifth pane |

The depth-4 layout used for the last row was `row[A, column[B, row[C, D]]]`, built through
`splitWithTab`; its four body zones tiled the host exactly (`450+450` wide, right column `374/374`,
bottom row `225/225`).

## Acceptance criteria

- [x] `resolveDropRegion` unit tests: centre band, four edges, axis tie → horizontal, exactly ±0.25
      resolving as an edge (the test is `< CENTER_BAND`), plus size/origin independence and a
      degenerate box.
- [x] `effectiveDropRegion` degrades a perpendicular edge at depth 4 while a same-direction edge stays
      intact, and uses `canSplit` (asserted by an 8-long flat run staying legal).
- [x] Dropping on each of the four edges splits in the matching direction with the dragged tab active
      in the new pane on the dropped side — `right` and (degraded) `bottom` exercised live, all four
      resolved by the tested pure function and applied through sprint-048's `splitWithTab`.
- [x] Central band moves without splitting.
- [x] The preview always matches the outcome: half-pane for a split, whole-pane for centre/degraded,
      nothing for no-op drops — each row above was read from the DOM *during* the drag and compared to
      the store *after* it.
- [x] Reorder within a strip and cross-strip tab drops land at the expected positions.
- [x] A drag released over no target changes nothing.
- [x] A terminal streaming in another pane keeps streaming during a split — the store-level guarantee
      is sprint-048's and the panel-identity guarantee was measured in task-002 (same DOM nodes across
      split/resize/collapse); the live streaming check with a real PTY is task-007 step 3.

## Notes / follow-ups

- The pointer position for region resolution comes from dnd-kit's `activatorEvent` + accumulated
  `delta` (a `PointerEvent` is a `MouseEvent`), which is exact and needs no extra listener.
- Droppable `data` is narrowed with a checked `dropTarget()` guard rather than an inline cast, per the
  repo's no-inline-cast rule.
