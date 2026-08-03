/**
 * Drop-region resolution for dragging a tab over a pane body — pure, so the geometry is unit-tested
 * without jsdom (this package's framework-free testing convention).
 *
 * The gesture layer's contract is that **the preview is always the outcome**: a region that cannot be
 * split degrades to `center` (a move into the pane) here, once, and both the preview and the drop
 * dispatch read the degraded value. That is why `effectiveDropRegion` exists instead of each caller
 * consulting `canSplit` on its own — two independent checks are two chances to disagree, and the user
 * would see a split preview and get a move.
 *
 * clean-room-scope/features/workspace-split-panes.md § Drop regions, § Resolving a drop region
 */

import { canSplit, type PaneNode, type SplitRegion } from "./pane-tree.js";

/**
 * Half-extent of the central move-into-pane target, as a fraction of the body. `0.25` makes the
 * central 50% of each axis a move target and the outer band a split target.
 */
export const CENTER_BAND = 0.25;

export type DropRegion = SplitRegion | "center";

export interface DropPoint {
  x: number;
  y: number;
}

export interface DropBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Which region of `body` the pointer is in. Offsets are normalized to ±0.5 from the centre, so the
 * decision is independent of the pane's size; an exact axis tie resolves to the horizontal axis.
 *
 * A degenerate body (zero width or height — a pane mid-layout) has no meaningful edges, so it reads
 * as `center`: a move, never a split into nothing.
 */
export function resolveDropRegion(pointer: DropPoint, body: DropBounds): DropRegion {
  if (body.width <= 0 || body.height <= 0) return "center";
  const dx = (pointer.x - (body.left + body.width / 2)) / body.width;
  const dy = (pointer.y - (body.top + body.height / 2)) / body.height;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < CENTER_BAND) return "center";
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "top" : "bottom";
}

/**
 * Whether `pointer` falls inside `bounds`, edges included.
 *
 * dnd-kit hit-tests its own measured rects, so internal drags never need this; a native drag has to
 * find its pane itself, from the drop zones' real client rects (`use-external-pane-drop.ts`) — the
 * strip offset lives in CSS as `var(--pane-strip-height)`, so measuring beats recomputing it here.
 */
export function containsPoint(bounds: DropBounds, pointer: DropPoint): boolean {
  return (
    pointer.x >= bounds.left &&
    pointer.x <= bounds.left + bounds.width &&
    pointer.y >= bounds.top &&
    pointer.y <= bounds.top + bounds.height
  );
}

/**
 * The region as it will actually be applied: an edge whose split is illegal (depth cap) degrades to
 * `center`. `center` and an unknown pane pass through unchanged.
 */
export function effectiveDropRegion(
  tree: PaneNode,
  paneId: string,
  region: DropRegion,
): DropRegion {
  if (region === "center") return "center";
  return canSplit(tree, paneId, region) ? region : "center";
}

/**
 * Whether dropping `tabId` on `region` of `paneId` would change anything.
 *
 * Two no-ops, and neither may flash a preview: a `center` drop into the pane the tab already sits in,
 * and a split whose source is the dragged tab's only tab — the new pane would take it and the old one
 * would collapse straight back.
 */
export function isNoOpDrop(
  region: DropRegion,
  paneId: string,
  tabId: string,
  placement: Readonly<Record<string, string>>,
): boolean {
  const source = placement[tabId];
  if (source !== paneId) return false;
  if (region === "center") return true;
  return Object.keys(placement).every((id) => id === tabId || placement[id] !== paneId);
}
