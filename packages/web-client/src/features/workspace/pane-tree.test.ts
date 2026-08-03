import { describe, expect, it } from "vitest";
import {
  canSplit,
  directionOfRegion,
  dividers,
  effectiveTree,
  leafIds,
  MAX_PANE_DEPTH,
  MIN_PANE_FRACTION,
  paneDepth,
  PANE_LAYOUT_VERSION,
  paneRects,
  parsePaneTree,
  removePane,
  resizeAtDivider,
  splitPane,
  type LeafPane,
  type PaneNode,
  type SplitNode,
} from "./pane-tree.js";

// ─── Builders ──────────────────────────────────────────────────────────────────────────────

function leaf(id: string): LeafPane {
  return { kind: "leaf", id };
}

function row(children: PaneNode[], sizes: number[]): SplitNode {
  return { kind: "split", direction: "row", children, sizes };
}

function col(children: PaneNode[], sizes: number[]): SplitNode {
  return { kind: "split", direction: "column", children, sizes };
}

/** Deepest leaf in the tree, using the module's own 1-based depth. */
function maxDepth(tree: PaneNode): number {
  return Math.max(...leafIds(tree).map((id) => paneDepth(tree, id)!));
}

/** Every split's `sizes` must stay parallel to `children` and sum to 1. */
function assertWellFormedSizes(node: PaneNode): void {
  if (node.kind === "leaf") return;
  expect(node.sizes).toHaveLength(node.children.length);
  expect(node.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1, 9);
  for (const size of node.sizes) expect(size).toBeGreaterThan(0);
  for (const child of node.children) assertWellFormedSizes(child);
}

/** A depth-4 tree: root row (1) > column (2) > row (3) > C/D (4). */
function depth4Tree(): SplitNode {
  return row(
    [leaf("A"), col([leaf("B"), row([leaf("C"), leaf("D")], [0.5, 0.5])], [0.5, 0.5])],
    [0.5, 0.5],
  );
}

// ─── paneDepth / leafIds ───────────────────────────────────────────────────────────────────

describe("paneDepth", () => {
  it("is 1 for a lone leaf", () => {
    expect(paneDepth(leaf("A"), "A")).toBe(1);
  });

  it("is 4 for a leaf nested under three splits", () => {
    const tree = depth4Tree();
    expect(paneDepth(tree, "C")).toBe(4);
    expect(paneDepth(tree, "D")).toBe(4);
    expect(paneDepth(tree, "B")).toBe(3);
    expect(paneDepth(tree, "A")).toBe(2);
    expect(maxDepth(tree)).toBe(MAX_PANE_DEPTH);
  });

  it("is null for a pane id that is not in the tree", () => {
    expect(paneDepth(depth4Tree(), "nope")).toBeNull();
  });
});

// ─── canSplit ──────────────────────────────────────────────────────────────────────────────

describe("canSplit", () => {
  it("allows a same-direction sibling insert at maximum depth but refuses the perpendicular one", () => {
    const tree = depth4Tree();
    // C's parent is a `row`, so left/right insert a sibling into that run — depth unchanged.
    expect(canSplit(tree, "C", "left")).toBe(true);
    expect(canSplit(tree, "C", "right")).toBe(true);
    // top/bottom would nest a `column` under C, pushing it to depth 5.
    expect(canSplit(tree, "C", "top")).toBe(false);
    expect(canSplit(tree, "C", "bottom")).toBe(false);
  });

  it("allows any region below the cap", () => {
    const tree = leaf("A");
    for (const region of ["left", "right", "top", "bottom"] as const) {
      expect(canSplit(tree, "A", region)).toBe(true);
    }
  });

  it("refuses a nesting split for a leaf already at the cap", () => {
    // B sits at depth 3 under a column; a column split reuses the run, a row split nests to 4.
    const tree = depth4Tree();
    expect(canSplit(tree, "B", "bottom")).toBe(true);
    expect(canSplit(tree, "B", "right")).toBe(true); // depth 3 + 1 = 4, still legal
  });

  it("refuses an unknown pane id", () => {
    expect(canSplit(depth4Tree(), "nope", "left")).toBe(false);
  });

  it("maps regions to axes", () => {
    expect(directionOfRegion("left")).toBe("row");
    expect(directionOfRegion("right")).toBe("row");
    expect(directionOfRegion("top")).toBe("column");
    expect(directionOfRegion("bottom")).toBe("column");
  });
});

// ─── splitPane ─────────────────────────────────────────────────────────────────────────────

describe("splitPane", () => {
  it("inserts a sibling into a same-direction parent without deepening the tree", () => {
    const tree = row([leaf("A"), leaf("B"), leaf("C")], [0.2, 0.3, 0.5]);
    const next = splitPane(tree, "B", "right", "N") as SplitNode;

    expect(next.children.map((c) => (c as LeafPane).id)).toEqual(["A", "B", "N", "C"]);
    expect(next.direction).toBe("row");
    expect(maxDepth(next)).toBe(maxDepth(tree));
    // The new pane takes half of B's former size; every other sibling is untouched.
    expect(next.sizes).toEqual([0.2, 0.15, 0.15, 0.5]);
    assertWellFormedSizes(next);
  });

  it("inserts before the target for `left`", () => {
    const tree = row([leaf("A"), leaf("B")], [0.4, 0.6]);
    const next = splitPane(tree, "B", "left", "N") as SplitNode;
    expect(next.children.map((c) => (c as LeafPane).id)).toEqual(["A", "N", "B"]);
    expect(next.sizes).toEqual([0.4, 0.3, 0.3]);
  });

  it("still splits at maximum depth when the region runs along the parent's direction", () => {
    const tree = depth4Tree();
    const next = splitPane(tree, "C", "right", "N");
    expect(maxDepth(next)).toBe(MAX_PANE_DEPTH);
    expect(leafIds(next)).toEqual(["A", "B", "C", "N", "D"]);
    assertWellFormedSizes(next);
  });

  it("replaces the leaf with a half/half split for a perpendicular region", () => {
    const beforeRegions = { left: "row", top: "column" } as const;
    for (const [region, direction] of Object.entries(beforeRegions)) {
      const next = splitPane(leaf("A"), "A", region as "left" | "top", "N") as SplitNode;
      expect(next.kind).toBe("split");
      expect(next.direction).toBe(direction);
      expect(next.sizes).toEqual([0.5, 0.5]);
      expect(next.children.map((c) => (c as LeafPane).id)).toEqual(["N", "A"]);
    }

    const afterRegions = { right: "row", bottom: "column" } as const;
    for (const [region, direction] of Object.entries(afterRegions)) {
      const next = splitPane(leaf("A"), "A", region as "right" | "bottom", "N") as SplitNode;
      expect(next.direction).toBe(direction);
      expect(next.children.map((c) => (c as LeafPane).id)).toEqual(["A", "N"]);
    }
  });

  it("splits a nested leaf in place, leaving the rest of the tree alone", () => {
    const tree = row([leaf("A"), col([leaf("B"), leaf("C")], [0.5, 0.5])], [0.4, 0.6]);
    const next = splitPane(tree, "B", "right", "N") as SplitNode;

    expect(next.sizes).toEqual([0.4, 0.6]);
    expect(next.children[0]).toEqual(leaf("A"));
    const inner = next.children[1] as SplitNode;
    expect(inner.direction).toBe("column");
    expect(inner.sizes).toEqual([0.5, 0.5]);
    const split = inner.children[0] as SplitNode;
    expect(split.direction).toBe("row");
    expect(split.children.map((c) => (c as LeafPane).id)).toEqual(["B", "N"]);
    assertWellFormedSizes(next);
  });

  it("returns a structurally equal tree when the split is refused", () => {
    const tree = depth4Tree();
    expect(splitPane(tree, "C", "top", "N")).toEqual(tree); // depth cap
    expect(splitPane(tree, "nope", "left", "N")).toEqual(tree); // unknown target
    expect(splitPane(tree, "C", "right", "A")).toEqual(tree); // duplicate pane id
  });
});

// ─── removePane ────────────────────────────────────────────────────────────────────────────

describe("removePane", () => {
  it("returns the tree unchanged for the only leaf", () => {
    const tree = leaf("A");
    expect(removePane(tree, "A")).toEqual(tree);
  });

  it("returns the tree unchanged for an unknown pane id", () => {
    const tree = row([leaf("A"), leaf("B")], [0.5, 0.5]);
    expect(removePane(tree, "nope")).toEqual(tree);
  });

  it("redistributes the removed pane's size proportionally across its siblings", () => {
    const tree = row([leaf("A"), leaf("B"), leaf("C")], [0.2, 0.3, 0.5]);
    const next = removePane(tree, "B") as SplitNode;

    expect(next.children.map((c) => (c as LeafPane).id)).toEqual(["A", "C"]);
    // A and C held 0.2 : 0.5 of the remainder, so B's 0.3 splits in that ratio.
    expect(next.sizes[0]).toBeCloseTo(0.2 / 0.7, 9);
    expect(next.sizes[1]).toBeCloseTo(0.5 / 0.7, 9);
    assertWellFormedSizes(next);
  });

  it("replaces a split left with one child by that child, inheriting its slot and size", () => {
    const tree = row([leaf("A"), col([leaf("B"), leaf("C")], [0.3, 0.7])], [0.4, 0.6]);
    const next = removePane(tree, "B") as SplitNode;

    expect(next.direction).toBe("row");
    expect(next.children.map((c) => (c as LeafPane).id)).toEqual(["A", "C"]);
    expect(next.sizes).toEqual([0.4, 0.6]); // C inherits the column's whole slot
    assertWellFormedSizes(next);
  });

  it("splices a promoted same-direction split flat instead of nesting it", () => {
    // row[A, column[B, row[C, D]]] minus B  ->  row[A, C, D]
    const tree = row(
      [leaf("A"), col([leaf("B"), row([leaf("C"), leaf("D")], [0.5, 0.5])], [0.5, 0.5])],
      [0.5, 0.5],
    );
    const next = removePane(tree, "B") as SplitNode;

    expect(next.direction).toBe("row");
    expect(next.children.map((c) => (c as LeafPane).id)).toEqual(["A", "C", "D"]);
    // The column's 0.5 slot was inherited whole by row[C, D]; C and D scale into it.
    expect(next.sizes[0]).toBeCloseTo(0.5, 9);
    expect(next.sizes[1]).toBeCloseTo(0.25, 9);
    expect(next.sizes[2]).toBeCloseTo(0.25, 9);
    expect(maxDepth(next)).toBe(2);
    assertWellFormedSizes(next);
  });

  it("collapses repeatedly up the tree", () => {
    // row[A, column[row[B, C]]]-shaped chains fully unwind to a lone leaf when only one remains.
    const tree = row([leaf("A"), col([leaf("B"), leaf("C")], [0.5, 0.5])], [0.5, 0.5]);
    const oneLeft = removePane(removePane(tree, "B"), "C");
    expect(oneLeft).toEqual(leaf("A"));
  });

  it("keeps every split well-formed across an interleaved split/remove sequence", () => {
    let tree: PaneNode = leaf("p0");
    const regions = ["right", "bottom", "left", "top", "right", "bottom"] as const;
    regions.forEach((region, i) => {
      const target = leafIds(tree)[i % leafIds(tree).length]!;
      tree = splitPane(tree, target, region, `p${i + 1}`);
      assertWellFormedSizes(tree);
      expect(maxDepth(tree)).toBeLessThanOrEqual(MAX_PANE_DEPTH);
    });
    while (leafIds(tree).length > 1) {
      tree = removePane(tree, leafIds(tree)[0]!);
      assertWellFormedSizes(tree);
    }
    expect(tree.kind).toBe("leaf");
  });
});

// ─── Purity ────────────────────────────────────────────────────────────────────────────────

describe("purity", () => {
  it("never mutates the input tree", () => {
    const tree = depth4Tree();
    const clone = structuredClone(tree);

    splitPane(tree, "C", "right", "N");
    splitPane(tree, "C", "top", "N");
    splitPane(tree, "A", "bottom", "N");
    removePane(tree, "B");
    removePane(tree, "C");
    paneDepth(tree, "D");
    leafIds(tree);
    canSplit(tree, "C", "top");

    expect(tree).toEqual(clone);
  });
});

// ─── paneRects ─────────────────────────────────────────────────────────────────────────────

describe("paneRects", () => {
  it("gives a lone leaf the whole area", () => {
    expect(paneRects(leaf("A")).get("A")).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("divides a row horizontally in proportion to sizes", () => {
    const rects = paneRects(row([leaf("A"), leaf("B")], [0.25, 0.75]));
    expect(rects.get("A")).toEqual({ x: 0, y: 0, width: 0.25, height: 1 });
    expect(rects.get("B")).toEqual({ x: 0.25, y: 0, width: 0.75, height: 1 });
  });

  it("divides a column vertically in proportion to sizes", () => {
    const rects = paneRects(col([leaf("A"), leaf("B")], [0.25, 0.75]));
    expect(rects.get("A")).toEqual({ x: 0, y: 0, width: 1, height: 0.25 });
    expect(rects.get("B")).toEqual({ x: 0, y: 0.25, width: 1, height: 0.75 });
  });

  it("composes nested splits multiplicatively", () => {
    // B and C share the right half of the area, stacked.
    const rects = paneRects(row([leaf("A"), col([leaf("B"), leaf("C")], [0.5, 0.5])], [0.5, 0.5]));
    expect(rects.get("A")).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
    expect(rects.get("B")).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
    expect(rects.get("C")).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  });

  it("keeps a three-deep nest inside its ancestor slots", () => {
    const rects = paneRects(depth4Tree());
    // C/D split the bottom half of the right half.
    expect(rects.get("C")).toEqual({ x: 0.5, y: 0.5, width: 0.25, height: 0.5 });
    expect(rects.get("D")).toEqual({ x: 0.75, y: 0.5, width: 0.25, height: 0.5 });
  });
});

// ─── dividers ──────────────────────────────────────────────────────────────────────────────

describe("dividers", () => {
  it("finds none in a lone leaf", () => {
    expect(dividers(leaf("A"))).toEqual([]);
  });

  it("yields N-1 boundaries at cumulative offsets for a row", () => {
    const found = dividers(row([leaf("A"), leaf("B"), leaf("C")], [0.2, 0.3, 0.5]));
    expect(found).toHaveLength(2);
    expect(found[0]).toEqual({
      splitPath: [],
      boundaryIndex: 0,
      direction: "row",
      rect: { x: 0.2, y: 0, width: 0, height: 1 },
      splitRect: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(found[1]!.rect).toEqual({ x: 0.5, y: 0, width: 0, height: 1 });
  });

  it("yields horizontal boundaries for a column", () => {
    const found = dividers(col([leaf("A"), leaf("B")], [0.3, 0.7]));
    expect(found).toHaveLength(1);
    expect(found[0]!.direction).toBe("column");
    expect(found[0]!.rect).toEqual({ x: 0, y: 0.3, width: 1, height: 0 });
  });

  it("addresses a nested split by its child-index path and spans only its own extent", () => {
    const found = dividers(row([leaf("A"), col([leaf("B"), leaf("C")], [0.5, 0.5])], [0.4, 0.6]));
    expect(found).toHaveLength(2);
    const [outer, inner] = found;
    expect(outer!.splitPath).toEqual([]);
    expect(outer!.rect).toEqual({ x: 0.4, y: 0, width: 0, height: 1 });
    expect(inner!.splitPath).toEqual([1]);
    expect(inner!.direction).toBe("column");
    // Spans the column's own cross-axis extent — the right 0.6, not the full width.
    expect(inner!.rect).toEqual({ x: 0.4, y: 0.5, width: 0.6, height: 0 });
  });

  it("carries the split's own rect, the denominator for a nested divider's pixel drag", () => {
    const found = dividers(row([leaf("A"), col([leaf("B"), leaf("C")], [0.5, 0.5])], [0.4, 0.6]));
    // The column owns the right 0.6 of the host: a 1px drag on its divider is 1/(0.6·hostHeight)
    // of ITS sizes, not 1/hostHeight.
    expect(found[1]!.splitRect).toEqual({ x: 0.4, y: 0, width: 0.6, height: 1 });
  });
});

// ─── resizeAtDivider ───────────────────────────────────────────────────────────────────────

describe("resizeAtDivider", () => {
  it("shifts size between the two adjacent siblings and leaves the rest byte-identical", () => {
    const tree = row([leaf("A"), leaf("B"), leaf("C"), leaf("D")], [0.1, 0.2, 0.3, 0.4]);
    const next = resizeAtDivider(tree, [], 1, 0.05) as SplitNode;

    expect(next.sizes[0]).toBe(0.1);
    expect(next.sizes[3]).toBe(0.4);
    expect(next.sizes[1]).toBeCloseTo(0.25, 9);
    expect(next.sizes[2]).toBeCloseTo(0.25, 9);
    assertWellFormedSizes(next);
  });

  it("resizes a nested split without touching its ancestors", () => {
    const tree = row([leaf("A"), col([leaf("B"), leaf("C")], [0.5, 0.5])], [0.4, 0.6]);
    const next = resizeAtDivider(tree, [1], 0, 0.2) as SplitNode;

    expect(next.sizes).toEqual([0.4, 0.6]);
    const inner = next.children[1] as SplitNode;
    expect(inner.sizes[0]).toBeCloseTo(0.7, 9);
    expect(inner.sizes[1]).toBeCloseTo(0.3, 9);
    assertWellFormedSizes(next);
  });

  it("clamps exactly at the minimum instead of overshooting", () => {
    const next = resizeAtDivider(row([leaf("A"), leaf("B")], [0.5, 0.5]), [], 0, 0.6) as SplitNode;
    expect(next.sizes[0]).toBeCloseTo(1 - MIN_PANE_FRACTION, 9);
    expect(next.sizes[1]).toBeCloseTo(MIN_PANE_FRACTION, 9);
  });

  it("lets a pane born below the minimum grow but never shrink further", () => {
    // Repeated splits halve the target each time, so N3 is legitimately born under the minimum.
    let tree: PaneNode = leaf("A");
    tree = splitPane(tree, "A", "right", "N1");
    tree = splitPane(tree, "N1", "right", "N2");
    tree = splitPane(tree, "N2", "right", "N3");
    tree = splitPane(tree, "N3", "right", "N4");
    const sizes = (tree as SplitNode).sizes;
    expect(sizes).toEqual([0.5, 0.25, 0.125, 0.0625, 0.0625]);
    expect(sizes[3]!).toBeLessThan(MIN_PANE_FRACTION);

    // Boundary 2 sits between N2 (0.125) and N3 (0.0625). A positive delta would shrink N3.
    expect(resizeAtDivider(tree, [], 2, 0.05)).toBe(tree);
    // A negative delta grows N3, clamped by what N2 can give down to the minimum.
    const grown = resizeAtDivider(tree, [], 2, -0.05) as SplitNode;
    expect(grown.sizes[2]).toBeCloseTo(MIN_PANE_FRACTION, 9);
    expect(grown.sizes[3]).toBeCloseTo(0.0875, 9);
    assertWellFormedSizes(grown);
  });

  it("ignores an unknown path, an out-of-range boundary, and a no-op delta", () => {
    const tree = row([leaf("A"), leaf("B")], [0.5, 0.5]);
    expect(resizeAtDivider(tree, [5], 0, 0.1)).toBe(tree);
    expect(resizeAtDivider(tree, [0], 0, 0.1)).toBe(tree); // path lands on a leaf
    expect(resizeAtDivider(tree, [], 1, 0.1)).toBe(tree); // only boundary 0 exists
    expect(resizeAtDivider(tree, [], -1, 0.1)).toBe(tree);
    expect(resizeAtDivider(tree, [], 0, 0)).toBe(tree);
    expect(resizeAtDivider(tree, [], 0, Number.NaN)).toBe(tree);
  });
});

// ─── effectiveTree ─────────────────────────────────────────────────────────────────────────

describe("effectiveTree", () => {
  it("returns the same tree when every leaf is occupied", () => {
    const tree = row([leaf("A"), leaf("B")], [0.5, 0.5]);
    expect(effectiveTree(tree, new Set(["A", "B"]))).toBe(tree);
  });

  it("drops unoccupied leaves and redistributes their space proportionally", () => {
    const tree = row([leaf("A"), leaf("B"), leaf("C")], [0.2, 0.3, 0.5]);
    const rendered = effectiveTree(tree, new Set(["A", "C"])) as SplitNode;

    expect(leafIds(rendered)).toEqual(["A", "C"]);
    expect(rendered.sizes[0]).toBeCloseTo(0.2 / 0.7, 9);
    expect(rendered.sizes[1]).toBeCloseTo(0.5 / 0.7, 9);
    assertWellFormedSizes(rendered);
  });

  it("applies the same collapse and flat-run splice as removePane", () => {
    const tree = row(
      [leaf("A"), col([leaf("B"), row([leaf("C"), leaf("D")], [0.5, 0.5])], [0.5, 0.5])],
      [0.5, 0.5],
    );
    const rendered = effectiveTree(tree, new Set(["A", "C", "D"])) as SplitNode;

    expect(rendered.direction).toBe("row");
    expect(leafIds(rendered)).toEqual(["A", "C", "D"]);
    expect(rendered.sizes.map((s) => Number(s.toFixed(6)))).toEqual([0.5, 0.25, 0.25]);
    expect(maxDepth(rendered)).toBe(2);
  });

  it("returns a single leaf rather than an empty tree when nothing is occupied", () => {
    const tree = row([leaf("A"), col([leaf("B"), leaf("C")], [0.5, 0.5])], [0.5, 0.5]);
    const rendered = effectiveTree(tree, new Set());
    expect(rendered.kind).toBe("leaf");
    expect(leafIds(rendered)).toHaveLength(1);
  });

  it("never mutates the stored tree", () => {
    const tree = depth4Tree();
    const clone = structuredClone(tree);
    effectiveTree(tree, new Set(["A"]));
    effectiveTree(tree, new Set());
    paneRects(tree);
    dividers(tree);
    resizeAtDivider(tree, [], 0, 0.2);
    expect(tree).toEqual(clone);
  });
});

// ─── parsePaneTree ─────────────────────────────────────────────────────────────────────────

describe("parsePaneTree", () => {
  it("exposes a layout-record version for the persistence envelope", () => {
    expect(PANE_LAYOUT_VERSION).toBe(1);
  });

  it("round-trips a valid leaf and a valid nested split", () => {
    expect(parsePaneTree(leaf("A"))).toEqual(leaf("A"));
    const tree = depth4Tree();
    expect(parsePaneTree(JSON.parse(JSON.stringify(tree)))).toEqual(tree);
  });

  it("renormalizes drifted sizes while preserving their proportions", () => {
    const parsed = parsePaneTree(
      row([leaf("A"), leaf("B"), leaf("C")], [0.3333, 0.3333, 0.3333]),
    ) as SplitNode;
    expect(parsed.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1, 12);
    expect(parsed.sizes[0]).toBeCloseTo(1 / 3, 12);
    expect(parsed.sizes[1]).toBeCloseTo(parsed.sizes[0]!, 15);
  });

  it("renormalizes a plausible hand-edit instead of rejecting it", () => {
    const parsed = parsePaneTree(row([leaf("A"), leaf("B")], [1, 1])) as SplitNode;
    expect(parsed.sizes).toEqual([0.5, 0.5]);
  });

  it("renormalizes nested splits independently of their parent's slot", () => {
    const parsed = parsePaneTree(
      row([leaf("A"), col([leaf("B"), leaf("C")], [2, 6])], [3, 1]),
    ) as SplitNode;
    expect(parsed.sizes).toEqual([0.75, 0.25]);
    expect((parsed.children[1] as SplitNode).sizes).toEqual([0.25, 0.75]);
    assertWellFormedSizes(parsed);
  });

  it("rejects a size/child length mismatch", () => {
    expect(parsePaneTree(row([leaf("A"), leaf("B")], [0.5, 0.3, 0.2]))).toBeNull();
    expect(parsePaneTree(row([leaf("A"), leaf("B")], [1]))).toBeNull();
  });

  it("rejects a split with fewer than two children", () => {
    expect(parsePaneTree(row([leaf("A")], [1]))).toBeNull();
    expect(parsePaneTree(row([], []))).toBeNull();
  });

  it("rejects non-finite, zero, negative, and non-numeric sizes", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -0.5, "0.5", null]) {
      expect(parsePaneTree(row([leaf("A"), leaf("B")], [0.5, bad as number]))).toBeNull();
    }
  });

  it("rejects a duplicated pane id anywhere in the tree", () => {
    expect(parsePaneTree(row([leaf("A"), leaf("A")], [0.5, 0.5]))).toBeNull();
    expect(
      parsePaneTree(row([leaf("A"), col([leaf("B"), leaf("A")], [0.5, 0.5])], [0.5, 0.5])),
    ).toBeNull();
  });

  it("rejects a leaf with a missing, non-string, or blank id", () => {
    expect(parsePaneTree({ kind: "leaf" })).toBeNull();
    expect(parsePaneTree({ kind: "leaf", id: 7 })).toBeNull();
    expect(parsePaneTree({ kind: "leaf", id: "" })).toBeNull();
    expect(parsePaneTree({ kind: "leaf", id: "   " })).toBeNull();
  });

  it("rejects an unknown kind and a bad direction", () => {
    expect(parsePaneTree({ kind: "pane", id: "A" })).toBeNull();
    expect(
      parsePaneTree({ kind: "split", direction: "diagonal", children: [], sizes: [] }),
    ).toBeNull();
  });

  it("discards the whole tree for damage nested three levels deep", () => {
    const damaged = row(
      [leaf("A"), col([leaf("B"), row([leaf("C"), leaf("D")], [0.5, Number.NaN])], [0.5, 0.5])],
      [0.5, 0.5],
    );
    expect(parsePaneTree(damaged)).toBeNull();
  });

  it("returns null for every non-tree input without throwing", () => {
    for (const bad of [null, undefined, "tree", 7, true, {}, [], [leaf("A")]]) {
      expect(parsePaneTree(bad)).toBeNull();
    }
  });

  it("produces a tree the geometry functions accept", () => {
    const parsed = parsePaneTree(row([leaf("A"), leaf("B"), leaf("C")], [1, 1, 2]))!;
    expect(leafIds(parsed)).toEqual(["A", "B", "C"]);
    expect(paneRects(parsed).get("C")).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
    expect(dividers(parsed)).toHaveLength(2);
    assertWellFormedSizes(parsed);
  });
});
