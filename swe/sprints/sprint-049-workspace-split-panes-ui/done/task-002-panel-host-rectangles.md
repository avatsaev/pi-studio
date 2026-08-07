# Task 002 — `TabPanelHost`: flat host positioned by pane rectangles

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** in_progress
- **Type:** feature
- **Area:** web-client / workspace
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Panels render at their pane's computed rectangle while remaining flat siblings in one stable
container — the continuity invariant's "flat host + computed rectangles" strategy — with resize and
visibility reaching size-sensitive panels.

## Context / why
`TabPanelHost` already implements the invariant's hard part: every panel stays mounted for the
tab's lifetime (`TabPanelHost.tsx:64–76`), and `TerminalPanel` kills its PTY **on unmount**
(`TerminalPanel.tsx:160–164`) — so panels must NEVER be re-parented into pane subtrees, which
would remount them. This task changes only *where* each panel paints and *when* it is visible:

- position: absolute rect = pane's fractional rect (from `effectiveTree` + `paneRects`) × the
  host's measured content box;
- visible: the tab is its pane's active tab (per-pane, NOT `=== activeTabId` — a pane's active tab
  is visible even when another pane is focused).

## Scope references
- `clean-room-scope/features/workspace-split-panes.md` § Panel continuity invariant, § Geometry,
  § Error Handling & Edge Cases (workspace-switch row)
- Modify: `packages/web-client/src/features/workspace/TabPanelHost.tsx`
- Modify: `packages/web-client/src/features/workspace/TabPanelHost.module.css`
- Reference: `packages/web-client/src/features/terminal/TerminalPanel.tsx` (refit-on-visible and
  kill-on-unmount contracts — do not modify unless its visibility hook reads `activeTabId` directly)
- Reference: `packages/web-client/src/features/chat/Timeline.tsx:66–70` (`display:none` measurement
  caveat)

## What to build
- Measure the host's content box with a `ResizeObserver`; multiply fractional rects by it. Store
  rects in component state — geometry changes must not remount panels (stable `key={tab.id}`,
  flat `tabs.map`, unchanged).
- Visibility: replace the `tab.id === activeTabId` check with `useIsTabVisible(tab.id)` from
  task-001. Tabs of non-visible workspaces stay mounted-hidden exactly as today.
- A visible panel gets its pane's rect as inline `left/top/width/height`; hidden panels keep the
  current hidden styling (the `display:none` + `.active` pattern) — do not switch hidden panels to
  zero-size boxes, `Timeline.tsx`'s measurement guard depends on the current pattern.
- Pane resize → visible panels' boxes change → size-sensitive panels re-measure. `TerminalPanel`
  already refits via its own `ResizeObserver`/visibility effect; verify it observes its own panel
  box (not the window) and now also refits on divider-driven size changes. Becoming visible in a
  non-focused pane must trigger the same refit (per-pane visibility, task-001's selector).
- Single-leaf tree renders one full-size rect — visually identical to today.
- Empty states (no workspace / no tabs, lines 33–60) unchanged.

## Out of scope
- Tab strips, dividers, drag-drop, focus ring (tasks 003–004).
- Any change to panel components' internals beyond the visibility-selector read.

## Acceptance criteria
- [ ] With one pane, the rendered DOM structure and visual result are indistinguishable from before
      (panel fills the host; same hidden-panel treatment).
- [ ] With a 2-pane split, both panes' active tabs are visible simultaneously at complementary
      rects; switching the active tab inside one pane never remounts the other's panel.
- [ ] Panels are never re-parented: splitting/moving/resizing changes only style props on the same
      DOM node (verify via element identity in a component test, and React key stability).
- [ ] A terminal in a non-focused pane stays interactive (scrollback, input) while `activeTabId`
      points elsewhere.
- [ ] Dragging a divider (simulated via store `resizeDivider`) refits a visible terminal to the new
      character grid and reports rows/cols upstream (resize frame sent — assert via the terminal
      store/mock, not visually).
- [ ] Workspace switch hides one workspace's panels and shows the other's without unmounting either
      (existing cross-workspace test pattern extended to panes).

## Test / verification plan
- Tests: component-level tests for visibility/identity where the existing test setup allows;
  store-level assertions for the rest. Run `npx vitest run packages/web-client/src/features/workspace/`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Manual: two-pane layout forced via `useLayoutStore.getState()` in the browser console — verify
  side-by-side rendering, terminal reflow on resize, and no panel flicker on layout mutations.

## Notes
- The `.panel` class stays absolutely positioned within `.area` (it already is — see
  memory of the module CSS); the change is per-panel inline rects instead of inset-0.
- If `TerminalPanel`'s visibility effect reads `activeTabId` directly, switch it to the task-001
  selector — that is the one panel-internal edit this task is allowed.
