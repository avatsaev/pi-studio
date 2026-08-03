# Task 003 — Per-pane tab strips, dividers, and pane focus

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** in_progress
- **Type:** feature
- **Area:** web-client / workspace
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal
Each pane renders its own tab strip and chrome; dividers between panes are draggable with the
resize clamp; clicking a pane focuses it; the focused pane is visually indicated.

## Context / why
Today one global `TabStrip` renders above one `TabPanelHost` (`WorkspacePage.tsx:42–43`). With
splits, the strip is per-pane state: each pane shows its own tabs and its own active tab. The
divider is an overlay (it must not consume layout space, or pane rects and panel rects drift), and
a single pane must be visually indistinguishable from a workspace without split support at all.

## Scope references
- `clean-room-scope/features/workspace-split-panes.md` § UI Behavior, § Resizing,
  § Tab ↔ pane assignment (focused pane)
- Modify: `packages/web-client/src/features/workspace/TabStrip.tsx` (accept a pane scope)
- Modify: `packages/web-client/src/features/workspace/TabPanelHost.tsx` (strip-per-pane layout)
- Modify: `packages/web-client/src/routes/WorkspacePage.tsx` (drop the single global strip)
- Create: `packages/web-client/src/features/workspace/PaneDividers.tsx` (+ module CSS)
- Reference: `packages/web-client/src/components/…/ResizeHandle` (existing sidebar drag pattern —
  reuse the delta-based pointer handling)

## What to build
- **`TabStrip` becomes pane-scoped**: `TabStrip({ paneId })` renders the pane's derived tab order
  (tab-store order filtered by `placement`), its pane-active tab highlighted, its own "+" menu
  (`NewTabMenu`) opening into **that** pane (open helpers already land in the focused pane — focus
  the pane on "+" click first). All strips are the same height as the current one.
- **Pane chrome**: each pane's rect from task-002 is divided into strip row + content body. The
  strip is part of the pane's rect, not global. With a single pane this reproduces today's layout
  exactly.
- **`PaneDividers`**: absolutely-positioned overlay rendering `dividers(effectiveTree)` — a few px
  wide hit area centred on the boundary, axis-appropriate cursor (`col-resize`/`row-resize`), hover
  affordance, pointer-capture drag calling `layout-store.resizeDivider` with
  `deltaPx / contentExtentPx` per move (delta-based like `ResizeHandle`, not absolute, to avoid
  stale-closure drift).
- **Focus**: pointer-down anywhere inside a pane (strip or body, unless the event hit an
  interactive element that stops propagation) → `focusPane`. Focused pane gets a subtle accent
  indicator (border or strip underline per the design tokens); with a single pane, NO indicator, no
  divider, no extra chrome.

## Out of scope
- Dragging tabs (reorder stays working within each strip via its existing dnd-kit context; the
  cross-pane/single-context rework is task-004).
- Split buttons/menus (task-005).

## Acceptance criteria
- [ ] Single pane: strip + panels visually identical to before (no divider, no focus ring, same
      strip height/position).
- [ ] Two panes: each strip lists only its pane's tabs in global-order projection; clicking a tab
      activates it in that pane only.
- [ ] Each pane's "+" opens the new tab in that pane and focuses it.
- [ ] Dividers render between adjacent panes only (N children → N−1), overlay the boundary without
      shifting content, and show the axis cursor.
- [ ] Dragging a divider resizes only the two adjacent panes, clamps at `MIN_PANE_FRACTION`, and the
      new proportions survive a reload (persistence from sprint-048 fires on the mutation).
- [ ] Clicking a pane's body focuses it; the focused pane shows the accent indicator; tab-scoped
      shortcuts (close-tab, new-terminal — `use-shortcuts.ts`) act on the focused pane's active tab.
- [ ] Reorder within a single strip still works exactly as today.

## Test / verification plan
- Tests: strip filtering and divider math are store/`pane-tree` level (already covered); add
  component tests for per-pane strip rendering and focus dispatch where the existing setup allows.
  Run `npx vitest run packages/web-client/src/features/workspace/`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npm run lint` on touched files; `npx oxfmt` scoped to them.
- Manual: build a 3-pane layout, drag dividers to extremes (clamp), click between panes (focus
  ring), reload (proportions restored).

## Notes
- Keep the strip's existing `DndContext` per strip in this task — a shared context replaces it in
  task-004; do not half-migrate here.
- `use-shortcuts.ts`'s close-tab path goes through `closeTab` → task-001 wiring; verify, don't
  reimplement.
