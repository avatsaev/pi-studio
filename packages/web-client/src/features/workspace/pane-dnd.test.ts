import { describe, expect, it } from "vitest";
import { CENTER_BAND, effectiveDropRegion, isNoOpDrop, resolveDropRegion } from "./pane-dnd.js";
import { MAX_PANE_DEPTH, splitPane, type PaneNode } from "./pane-tree.js";

/** A 400×200 body at the origin: centre (200, 100), so ±0.25 lands on x=100/300, y=50/150. */
const BODY = { left: 0, top: 0, width: 400, height: 200 };

function at(x: number, y: number) {
  return resolveDropRegion({ x, y }, BODY);
}

describe("resolveDropRegion", () => {
  it("returns center inside the central band on both axes", () => {
    expect(at(200, 100)).toBe("center"); // dead centre
    expect(at(299, 100)).toBe("center"); // |dx| just under 0.25
    expect(at(200, 149)).toBe("center"); // |dy| just under 0.25
    expect(at(299, 149)).toBe("center");
  });

  it("returns the four edge regions outside the band", () => {
    expect(at(10, 100)).toBe("left");
    expect(at(390, 100)).toBe("right");
    expect(at(200, 5)).toBe("top");
    expect(at(200, 195)).toBe("bottom");
  });

  it("treats exactly ±CENTER_BAND as outside the band", () => {
    // `< CENTER_BAND` is the center test, so the boundary itself is an edge region.
    const edgeX = BODY.left + BODY.width * (0.5 + CENTER_BAND);
    const edgeY = BODY.top + BODY.height * (0.5 - CENTER_BAND);
    expect(at(edgeX, 100)).toBe("right");
    expect(at(200, edgeY)).toBe("top");
  });

  it("resolves an axis tie to the horizontal axis", () => {
    // Equal normalized offsets: dx = dy = +0.5 → horizontal wins.
    expect(at(400, 200)).toBe("right");
    // dx = dy = -0.5 → left, not top.
    expect(at(0, 0)).toBe("left");
  });

  it("normalizes per axis, so a wide pane's corners are not all horizontal", () => {
    // 40 px from the left edge is |dx| = 0.4; 5 px from the top is |dy| = 0.475 → vertical wins.
    expect(at(40, 5)).toBe("top");
  });

  it("is size- and origin-independent", () => {
    const shifted = { left: 1000, top: 500, width: 40, height: 20 };
    expect(resolveDropRegion({ x: 1020, y: 510 }, shifted)).toBe("center");
    expect(resolveDropRegion({ x: 1001, y: 510 }, shifted)).toBe("left");
  });

  it("reads a degenerate body as center rather than splitting into nothing", () => {
    expect(resolveDropRegion({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 })).toBe(
      "center",
    );
  });
});

/** A same-direction run `MAX_PANE_DEPTH` deep along `row`, ending in leaf "deep". */
function deepRowNest(): { tree: PaneNode; deepest: string } {
  // Nest perpendicular each time to actually spend depth: row → column → row → column.
  let tree: PaneNode = { kind: "leaf", id: "p1" };
  let target = "p1";
  for (let i = 2; i <= MAX_PANE_DEPTH; i += 1) {
    const region = i % 2 === 0 ? "right" : "bottom";
    tree = splitPane(tree, target, region, `p${i}`);
    target = `p${i}`;
  }
  return { tree, deepest: target };
}

describe("effectiveDropRegion", () => {
  it("passes center through untouched", () => {
    const tree: PaneNode = { kind: "leaf", id: "A" };
    expect(effectiveDropRegion(tree, "A", "center")).toBe("center");
  });

  it("keeps a legal edge region", () => {
    const tree: PaneNode = { kind: "leaf", id: "A" };
    expect(effectiveDropRegion(tree, "A", "right")).toBe("right");
    expect(effectiveDropRegion(tree, "A", "bottom")).toBe("bottom");
  });

  it("degrades a perpendicular edge to center at the depth cap, per region", () => {
    const { tree, deepest } = deepRowNest();
    // The deepest pane sits in a `row` run at depth 4: another row split is a sibling insert
    // (legal), a column split would nest deeper (refused → degraded).
    expect(effectiveDropRegion(tree, deepest, "right")).toBe("right");
    expect(effectiveDropRegion(tree, deepest, "bottom")).toBe("center");
  });

  it("degrades every region for a pane that is not in the tree", () => {
    const tree: PaneNode = { kind: "leaf", id: "A" };
    expect(effectiveDropRegion(tree, "ghost", "left")).toBe("center");
  });

  it("uses canSplit rather than duplicating the depth rule", () => {
    // A flat run of same-direction siblings never spends depth, so an edge along it stays legal
    // however long the run gets.
    let tree: PaneNode = { kind: "leaf", id: "A" };
    for (let i = 0; i < 8; i += 1) tree = splitPane(tree, "A", "right", `n${i}`);
    expect(effectiveDropRegion(tree, "A", "right")).toBe("right");
  });
});

describe("isNoOpDrop", () => {
  const placement = { t1: "P1", t2: "P1", t3: "P2" };

  it("is a no-op to center-drop a tab into the pane it already occupies", () => {
    expect(isNoOpDrop("center", "P1", "t1", placement)).toBe(true);
  });

  it("is not a no-op to center-drop into another pane", () => {
    expect(isNoOpDrop("center", "P2", "t1", placement)).toBe(false);
  });

  it("is a no-op to split a pane using its only tab", () => {
    // The new pane would take t3 and P2 would collapse right back — and it must not flash a preview.
    expect(isNoOpDrop("right", "P2", "t3", placement)).toBe(true);
  });

  it("is a real split when the source pane keeps another tab", () => {
    expect(isNoOpDrop("right", "P1", "t1", placement)).toBe(false);
  });

  it("is a real split when the tab comes from a different pane", () => {
    expect(isNoOpDrop("bottom", "P1", "t3", placement)).toBe(false);
  });
});
