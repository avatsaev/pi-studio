/**
 * Pure render decisions for the panel host: where each tab's panel paints and whether it is on
 * screen. No React, no store subscriptions — extracted so the geometry is unit-testable without
 * jsdom (this package's framework-free testing convention, same shape as `status-bar-format.ts` and
 * `timeline/inline-image-view.ts`).
 *
 * The list `panelBoxes` returns is derived from `tabs` alone in `tabs` order, which is the machinery
 * behind the continuity invariant: a layout mutation changes each entry's `style`/`visible`, never
 * the set or the order of entries, so React reconciles the same DOM nodes in place and no panel is
 * ever remounted or re-parented (`TerminalPanel` kills its PTY on unmount).
 *
 * clean-room-scope/features/workspace-split-panes.md § Panel continuity invariant, § Geometry
 */

import type { CSSProperties } from "react";
import type { WorkspacePaneLayout } from "@pi-studio-ui/stores/layout-store.js";
import type { Tab } from "@pi-studio-ui/stores/tab-store.js";
import { dividers, effectiveTree, paneRects, type Divider, type Rect } from "./pane-tree.js";
import type { DropRegion } from "./pane-dnd.js";

/**
 * Height of a pane's tab strip, matching `TabStrip.module.css`'s 33px row (border-box, so the bottom
 * border is inside it). A pane's rect is split into this strip plus the panel body below, which is
 * why panel styles are `calc(<percentage> ± this)`.
 *
 * Deliberately NOT a `--pi-*` name: that prefix is reserved for theme-emitted design tokens and
 * `theme/token-integrity.test.ts` fails any `var(--pi-…)` the theme does not define. This is a
 * component-local layout metric, declared on `TabPanelHost.module.css`'s `.area`.
 */
const STRIP_HEIGHT = "var(--pane-strip-height)";

export interface PanelBox {
  tabId: string;
  /** Percentage rect of the tab's pane body; `undefined` means "keep the CSS full box". */
  style: CSSProperties | undefined;
  /** Its workspace is in view **and** it is its own pane's active tab — per pane, not per workspace. */
  visible: boolean;
}

export interface PaneChrome {
  paneId: string;
  /** The strip row across the top of the pane's rect. */
  stripStyle: CSSProperties;
  /** Whether to show the focused-pane indicator — never with a single pane, where it is noise. */
  focused: boolean;
}

/**
 * Fractional rects of the panes that actually hold tabs. A pane still waiting for a restored tab to
 * claim it renders as absent — `effectiveTree` redistributes its fraction without touching the
 * stored tree, so no blank gap shows while the daemon's inventories are still arriving.
 */
export function occupiedPaneRects(layout: WorkspacePaneLayout | undefined): Map<string, Rect> {
  if (layout === undefined) return new Map();
  return paneRects(effectiveTree(layout.tree, new Set(Object.values(layout.placement))));
}

/** `0.333333` → `"33.3333%"`; trailing zeros trimmed, because this string lands in the DOM. */
export function percent(fraction: number): string {
  const fixed = (fraction * 100).toFixed(4);
  return `${fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed}%`;
}

/**
 * A pane's **body** as absolute-position percentages: its rect minus the strip row at its top.
 * `undefined` when the tab has no pane in the workspace in view (another workspace's tab — always
 * hidden, and it keeps the stylesheet's full box rather than collapsing to 0×0, which
 * `Timeline.tsx`'s virtualizer measurement guard relies on).
 */
export function paneStyle(rect: Rect | undefined): CSSProperties | undefined {
  if (rect === undefined) return undefined;
  return {
    left: percent(rect.x),
    top: `calc(${percent(rect.y)} + ${STRIP_HEIGHT})`,
    width: percent(rect.width),
    height: `calc(${percent(rect.height)} - ${STRIP_HEIGHT})`,
  };
}

/**
 * Where a drop would land, as an absolute-position box over the target pane's **body**: the half the
 * new pane would occupy for an edge region, the whole body for `center`. Whatever this returns is
 * what the drop does — `pane-dnd.ts` has already degraded an illegal edge to `center`.
 */
export function dropPreviewStyle(rect: Rect, region: DropRegion): CSSProperties {
  const bodyTop = `${percent(rect.y)} + ${STRIP_HEIGHT}`;
  const bodyHeight = `${percent(rect.height)} - ${STRIP_HEIGHT}`;
  const halfHeight = `calc((${bodyHeight}) / 2)`;
  switch (region) {
    case "left":
      return {
        left: percent(rect.x),
        top: `calc(${bodyTop})`,
        width: percent(rect.width / 2),
        height: `calc(${bodyHeight})`,
      };
    case "right":
      return {
        left: percent(rect.x + rect.width / 2),
        top: `calc(${bodyTop})`,
        width: percent(rect.width / 2),
        height: `calc(${bodyHeight})`,
      };
    case "top":
      return {
        left: percent(rect.x),
        top: `calc(${bodyTop})`,
        width: percent(rect.width),
        height: halfHeight,
      };
    case "bottom":
      return {
        left: percent(rect.x),
        top: `calc(${bodyTop} + (${bodyHeight}) / 2)`,
        width: percent(rect.width),
        height: halfHeight,
      };
    case "center":
      return {
        left: percent(rect.x),
        top: `calc(${bodyTop})`,
        width: percent(rect.width),
        height: `calc(${bodyHeight})`,
      };
  }
}

/**
 * One entry per **rendered** pane (see `occupiedPaneRects`), in tree order. Panes are chrome, not
 * panels: they may come and go freely, since nothing stateful is mounted inside a strip.
 */
export function paneChrome(layout: WorkspacePaneLayout | undefined): PaneChrome[] {
  const rects = occupiedPaneRects(layout);
  return [...rects].map(([paneId, rect]) => ({
    paneId,
    stripStyle: {
      left: percent(rect.x),
      top: percent(rect.y),
      width: percent(rect.width),
      height: STRIP_HEIGHT,
    },
    focused: rects.size > 1 && layout?.focusedPaneId === paneId,
  }));
}

/**
 * The draggable boundaries of the layout **as rendered** — and none at all while some pane is still
 * unoccupied. `resizeDivider` addresses a split by its path in the *stored* tree, so offering a
 * divider whose path came from a pruned effective tree would resize the wrong split. `effectiveTree`
 * returns the stored tree by identity when nothing is vacant, which makes the guard exact and free.
 */
export function paneDividers(layout: WorkspacePaneLayout | undefined): Divider[] {
  if (layout === undefined) return [];
  const rendered = effectiveTree(layout.tree, new Set(Object.values(layout.placement)));
  if (rendered !== layout.tree) return [];
  return dividers(rendered);
}

export function panelBoxes(
  tabs: readonly Tab[],
  activeWorkspaceCwd: string | null,
  layout: WorkspacePaneLayout | undefined,
): PanelBox[] {
  const rects = occupiedPaneRects(layout);
  return tabs.map((tab) => {
    const pane = tab.workspaceCwd === activeWorkspaceCwd ? layout?.placement[tab.id] : undefined;
    return {
      tabId: tab.id,
      style: paneStyle(pane === undefined ? undefined : rects.get(pane)),
      visible: pane !== undefined && layout?.activeByPane[pane] === tab.id,
    };
  });
}
