/**
 * Pane tree — the pure split/collapse algebra behind workspace split panes.
 *
 * No React, no store, no persistence: a workspace's pane arrangement is a tree of leaves and
 * splits, and every operation on it is a total function from tree to tree. Keeping it here means
 * the two rules that carry real bug risk are exhaustively testable without a DOM:
 *
 *  1. **Depth is checked per branch.** Inserting a sibling into an existing same-direction run
 *     never deepens the tree, so at `MAX_PANE_DEPTH` a split *along* the run's direction is still
 *     legal — only a perpendicular (nesting) split is refused.
 *  2. **Collapse keeps runs flat.** A split left with one child is replaced by that child, and if
 *     that child is a same-direction split its children are spliced into the parent — otherwise
 *     removing a pane silently produces same-direction nesting, wasting depth against the cap and
 *     changing divider behaviour.
 *
 * swe/features/workspace-split-panes.md § Pane tree, § Splitting,
 * § Removing a pane / collapsing
 */

export interface LeafPane {
  kind: "leaf";
  id: string;
}

export interface SplitNode {
  kind: "split";
  direction: SplitDirection;
  /** Always >= 2 entries; parallel to `sizes`. */
  children: PaneNode[];
  /** Parallel to `children`; each > 0, summing to 1. */
  sizes: number[];
}

export type SplitDirection = "row" | "column";
export type PaneNode = LeafPane | SplitNode;
export type SplitRegion = "left" | "right" | "top" | "bottom";

/** Deepest tree a split may produce. A lone leaf is depth 1. Matches `workspace-ui.md`. */
export const MAX_PANE_DEPTH = 4;

/** Region → split axis. Shared by `canSplit`, `splitPane`, and the drop-region gesture layer. */
export function directionOfRegion(region: SplitRegion): SplitDirection {
  return region === "left" || region === "right" ? "row" : "column";
}

export function leafIds(tree: PaneNode): string[] {
  if (tree.kind === "leaf") return [tree.id];
  return tree.children.flatMap(leafIds);
}

function hasLeaf(tree: PaneNode, paneId: string): boolean {
  if (tree.kind === "leaf") return tree.id === paneId;
  return tree.children.some((child) => hasLeaf(child, paneId));
}

/** 1-based: a lone leaf is depth 1, a leaf under three nested splits is depth 4. `depth` is the
 * recursion accumulator — callers pass only the tree and the pane id. */
export function paneDepth(node: PaneNode, paneId: string, depth = 1): number | null {
  if (node.kind === "leaf") return node.id === paneId ? depth : null;
  for (const child of node.children) {
    const found = paneDepth(child, paneId, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/** The split that directly holds `paneId` as a leaf child, or `null` for the root leaf. */
function parentSplitOf(tree: PaneNode, paneId: string): SplitNode | null {
  if (tree.kind === "leaf") return null;
  if (directChildIndex(tree, paneId) !== -1) return tree;
  for (const child of tree.children) {
    const found = parentSplitOf(child, paneId);
    if (found) return found;
  }
  return null;
}

function directChildIndex(split: SplitNode, paneId: string): number {
  return split.children.findIndex((child) => child.kind === "leaf" && child.id === paneId);
}

/**
 * Whether splitting `targetPaneId` towards `region` is legal.
 *
 * Evaluated per branch, *after* resolving whether the split reuses a same-direction parent: a
 * sibling insert leaves depth untouched and is always legal, so only a nesting split can hit the
 * cap. A single `depth + 1 > MAX` check would wrongly refuse both.
 */
export function canSplit(tree: PaneNode, targetPaneId: string, region: SplitRegion): boolean {
  const depth = paneDepth(tree, targetPaneId);
  if (depth === null) return false;
  const parent = parentSplitOf(tree, targetPaneId);
  if (parent && parent.direction === directionOfRegion(region)) return true;
  return depth + 1 <= MAX_PANE_DEPTH;
}

/**
 * Split `targetPaneId`, placing `newPaneId` on the side `region` names.
 *
 * Returns the tree **unchanged** when the split is illegal (`canSplit` false, unknown target, or a
 * `newPaneId` already in the tree). Refusal is a backstop for programmatic callers and corrupted
 * state, not an error: the drag gesture degrades an illegal edge region to a `center` move instead
 * of ever calling this and getting nothing.
 */
export function splitPane(
  tree: PaneNode,
  targetPaneId: string,
  region: SplitRegion,
  newPaneId: string,
): PaneNode {
  if (!canSplit(tree, targetPaneId, region)) return tree;
  if (hasLeaf(tree, newPaneId)) return tree;

  const direction = directionOfRegion(region);
  // `left`/`top` place the new pane before the target; `right`/`bottom` after it.
  const before = region === "left" || region === "top";
  const added: LeafPane = { kind: "leaf", id: newPaneId };

  const nest = (target: LeafPane): SplitNode => ({
    kind: "split",
    direction,
    children: before ? [added, target] : [target, added],
    sizes: [0.5, 0.5],
  });

  const transform = (node: PaneNode): PaneNode => {
    if (node.kind === "leaf") return node.id === targetPaneId ? nest(node) : node;
    const idx = directChildIndex(node, targetPaneId);
    // Reuse an existing same-direction run instead of nesting deeper: repeated splits in one
    // direction stay one flat run, which keeps sibling resizing intuitive and spends no depth.
    if (idx !== -1 && node.direction === direction) {
      const half = node.sizes[idx]! / 2;
      const at = before ? idx : idx + 1;
      const children = node.children.slice();
      const sizes = node.sizes.slice();
      sizes[idx] = half;
      children.splice(at, 0, added);
      sizes.splice(at, 0, half);
      return { kind: "split", direction: node.direction, children, sizes };
    }
    return {
      kind: "split",
      direction: node.direction,
      children: node.children.map(transform),
      sizes: node.sizes.slice(),
    };
  };

  return transform(tree);
}

/**
 * Remove a leaf, redistributing its size proportionally across its remaining siblings and
 * collapsing upward. Never removes the last leaf — a workspace always has at least one pane, and
 * the single-leaf tree is the terminal state.
 */
export function removePane(tree: PaneNode, paneId: string): PaneNode {
  if (!hasLeaf(tree, paneId)) return tree;
  if (tree.kind === "leaf") return tree; // the only leaf

  const drop = (node: PaneNode): PaneNode => {
    if (node.kind === "leaf") return node;
    const idx = directChildIndex(node, paneId);
    if (idx === -1) {
      return {
        kind: "split",
        direction: node.direction,
        children: node.children.map(drop),
        sizes: node.sizes.slice(),
      };
    }
    const kept = node.sizes.filter((_, i) => i !== idx);
    const keptTotal = kept.reduce((sum, size) => sum + size, 0);
    const slotTotal = keptTotal + node.sizes[idx]!;
    return {
      kind: "split",
      direction: node.direction,
      children: node.children.filter((_, i) => i !== idx),
      // Proportional: each survivor keeps its share of the siblings' combined size, rescaled to
      // fill the whole slot the removed pane was part of.
      sizes: kept.map((size) => (size / keptTotal) * slotTotal),
    };
  };

  return normalizePaneTree(drop(tree));
}

/**
 * Collapse single-child splits and splice same-direction runs flat, bottom-up.
 *
 * Without the splice, removing `B` from `row[A, column[B, row[C, D]]]` would promote `row[C, D]`
 * into the outer row as a nested same-direction split; this restores `row[A, C, D]`.
 */
export function normalizePaneTree(node: PaneNode): PaneNode {
  if (node.kind === "leaf") return node;

  const normalized = node.children.map(normalizePaneTree);
  // A split left with one child is replaced by that child, which inherits the parent's slot.
  if (normalized.length === 1) return normalized[0]!;

  const children: PaneNode[] = [];
  const sizes: number[] = [];
  normalized.forEach((child, i) => {
    const slot = node.sizes[i]!;
    if (child.kind === "split" && child.direction === node.direction) {
      child.children.forEach((grandChild, j) => {
        children.push(grandChild);
        sizes.push(slot * child.sizes[j]!);
      });
    } else {
      children.push(child);
      sizes.push(slot);
    }
  });

  if (children.length === 1) return children[0]!;
  return { kind: "split", direction: node.direction, children, sizes };
}

// ─── Geometry ──────────────────────────────────────────────────────────────────────────────

/**
 * Smallest fraction a divider drag may leave a pane at.
 *
 * A **resize** constraint, not a global invariant: `splitPane` halves its target unconditionally,
 * so repeated splits can legitimately *birth* a pane below this. The clamp only guarantees a drag
 * never reduces a neighbour below the minimum — an already-sub-minimum neighbour can still grow.
 */
export const MIN_PANE_FRACTION = 0.1;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Fractional rectangles (0..1) keyed by pane id; callers multiply by their measured content box.
 *
 * Kept fractional on purpose: the flat panel host re-derives pixel boxes from one `ResizeObserver`
 * measurement, so a container resize never has to walk the tree again.
 */
export function paneRects(tree: PaneNode): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  const walk = (node: PaneNode, rect: Rect): void => {
    if (node.kind === "leaf") {
      rects.set(node.id, rect);
      return;
    }
    childRects(node, rect).forEach((childRect, i) => walk(node.children[i]!, childRect));
  };
  walk(tree, { x: 0, y: 0, width: 1, height: 1 });
  return rects;
}

/** A split's own rect divided along `direction` in proportion to `sizes`. */
function childRects(split: SplitNode, rect: Rect): Rect[] {
  const out: Rect[] = [];
  let offset = 0;
  for (const size of split.sizes) {
    out.push(
      split.direction === "row"
        ? {
            x: rect.x + offset * rect.width,
            y: rect.y,
            width: size * rect.width,
            height: rect.height,
          }
        : {
            x: rect.x,
            y: rect.y + offset * rect.height,
            width: rect.width,
            height: size * rect.height,
          },
    );
    offset += size;
  }
  return out;
}

/** Child indices from the root down to a split; the root split's path is `[]`. */
export type SplitPath = readonly number[];

export interface Divider {
  splitPath: SplitPath;
  /** Boundary between `children[boundaryIndex]` and `children[boundaryIndex + 1]`. */
  boundaryIndex: number;
  direction: SplitDirection;
  /** Zero-thickness line spanning the split's cross-axis extent; the UI gives it a hit area. */
  rect: Rect;
  /**
   * The split's OWN rect. `sizes` are fractions of this, not of the whole host, so this is the
   * denominator a drag needs: `deltaFraction = deltaPx / (splitRect extent along `direction` × host
   * extent)`. Using the host extent instead would under-move every nested split's divider.
   */
  splitRect: Rect;
}

/** A split with N children owns N−1 interior boundaries. */
export function dividers(tree: PaneNode): Divider[] {
  const out: Divider[] = [];
  const walk = (node: PaneNode, rect: Rect, path: number[]): void => {
    if (node.kind === "leaf") return;
    const rects = childRects(node, rect);
    for (let i = 0; i < node.children.length - 1; i += 1) {
      const after = rects[i]!;
      out.push({
        splitPath: path.slice(),
        boundaryIndex: i,
        direction: node.direction,
        rect:
          node.direction === "row"
            ? { x: after.x + after.width, y: rect.y, width: 0, height: rect.height }
            : { x: rect.x, y: after.y + after.height, width: rect.width, height: 0 },
        splitRect: rect,
      });
    }
    rects.forEach((childRect, i) => walk(node.children[i]!, childRect, [...path, i]));
  };
  walk(tree, { x: 0, y: 0, width: 1, height: 1 }, []);
  return out;
}

function nodeAtPath(tree: PaneNode, path: SplitPath): PaneNode | null {
  let node: PaneNode | undefined = tree;
  for (const index of path) {
    if (!node || node.kind !== "split") return null;
    node = node.children[index];
  }
  return node ?? null;
}

/**
 * Shift `deltaFraction` from `children[boundaryIndex + 1]` to `children[boundaryIndex]`, clamped so
 * neither neighbour is reduced below `MIN_PANE_FRACTION`. Only those two siblings change.
 *
 * `deltaFraction` is the pointer delta along the split axis divided by the content box's extent on
 * that axis — the pixel conversion belongs to the UI, not here.
 */
export function resizeAtDivider(
  tree: PaneNode,
  splitPath: SplitPath,
  boundaryIndex: number,
  deltaFraction: number,
): PaneNode {
  const split = nodeAtPath(tree, splitPath);
  if (!split || split.kind !== "split") return tree;
  if (boundaryIndex < 0 || boundaryIndex > split.children.length - 2) return tree;
  if (!Number.isFinite(deltaFraction) || deltaFraction === 0) return tree;

  const before = split.sizes[boundaryIndex]!;
  const after = split.sizes[boundaryIndex + 1]!;
  // Each neighbour's floor is its own size when already under the minimum, so a sub-minimum pane
  // can be grown but never shrunk further — the "born below the minimum" case falls out of this.
  const giveable = after - Math.min(after, MIN_PANE_FRACTION);
  const takeable = before - Math.min(before, MIN_PANE_FRACTION);
  const delta = Math.max(-takeable, Math.min(giveable, deltaFraction));
  if (delta === 0) return tree;

  const resized = (node: SplitNode): SplitNode => {
    const sizes = node.sizes.slice();
    sizes[boundaryIndex] = before + delta;
    sizes[boundaryIndex + 1] = after - delta;
    return { kind: "split", direction: node.direction, children: node.children, sizes };
  };

  const rebuild = (node: PaneNode, depth: number): PaneNode => {
    if (node.kind !== "split") return node;
    if (depth === splitPath.length) return resized(node);
    const index = splitPath[depth]!;
    const children = node.children.slice();
    children[index] = rebuild(node.children[index]!, depth + 1);
    return { kind: "split", direction: node.direction, children, sizes: node.sizes.slice() };
  };

  return rebuild(tree, 0);
}

/**
 * The tree **as rendered**: leaves absent from `occupied` are dropped and collapsed exactly as
 * `removePane` would, without touching the stored tree.
 *
 * During restore a persisted pane may hold no tab yet; it must render as absent (its fraction
 * redistributed) while staying in the stored tree, because its tab may simply not have arrived from
 * the daemon yet. Pruning for real is tied to the hydration settle point, not to geometry.
 */
export function effectiveTree(tree: PaneNode, occupied: ReadonlySet<string>): PaneNode {
  const vacant = leafIds(tree).filter((id) => !occupied.has(id));
  if (vacant.length === 0) return tree;
  // `removePane` refuses the last leaf, so an entirely unoccupied tree lands on the single-leaf
  // terminal state rather than an empty tree.
  return vacant.reduce<PaneNode>((node, id) => removePane(node, id), tree);
}

// ─── Parsing untrusted persisted trees ─────────────────────────────────────────────────────

/** Bumped only on a breaking layout-record shape change; a mismatch discards the whole record. */
export const PANE_LAYOUT_VERSION = 1;

/**
 * Parse untrusted persisted JSON into a valid tree, or `null` when it is structurally damaged.
 * Never throws — callers treat `null` as "start this workspace from a single pane".
 *
 * The line between repair and rejection is deliberate. Sizes that merely drift from summing to 1
 * are **renormalized**: float error accumulates across save/load cycles and losing a layout to
 * rounding would be a bug. Structural damage — length mismatch, duplicate pane ids, non-finite or
 * non-positive sizes, a split with fewer than two children — is **rejected**, because a malformed
 * tree would otherwise crash geometry or render one pane twice.
 */
export function parsePaneTree(input: unknown): PaneNode | null {
  return parseNode(input, new Set());
}

function parseNode(input: unknown, seenIds: Set<string>): PaneNode | null {
  if (typeof input !== "object" || input === null) return null;
  const node = input as Partial<Record<keyof SplitNode | "id", unknown>>;

  if (node.kind === "leaf") {
    const { id } = node;
    if (typeof id !== "string" || id.trim() === "") return null;
    if (seenIds.has(id)) return null; // a repeated id would render the same pane twice
    seenIds.add(id);
    return { kind: "leaf", id };
  }

  if (node.kind !== "split") return null;
  if (node.direction !== "row" && node.direction !== "column") return null;
  if (!Array.isArray(node.children) || !Array.isArray(node.sizes)) return null;
  if (node.children.length < 2 || node.sizes.length !== node.children.length) return null;

  let total = 0;
  for (const size of node.sizes) {
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return null;
    total += size;
  }

  const children: PaneNode[] = [];
  for (const child of node.children) {
    const parsed = parseNode(child, seenIds);
    if (!parsed) return null; // damage propagates up: a partially valid tree is still discarded
    children.push(parsed);
  }

  return {
    kind: "split",
    direction: node.direction,
    children,
    // Renormalize unconditionally — no epsilon threshold — so "sizes sum to 1" is true by
    // construction for every tree that enters the store.
    sizes: (node.sizes as number[]).map((size) => size / total),
  };
}
