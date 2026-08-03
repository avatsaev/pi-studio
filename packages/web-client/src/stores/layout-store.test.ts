import { beforeEach, describe, expect, it } from "vitest";
import { useLayoutStore, type WorkspacePaneLayout } from "./layout-store.js";
import type { ValidatedWorkspaceLayout } from "@pi-studio-ui/lib/pane-layout-persistence.js";
import {
  leafIds,
  paneRects,
  type PaneNode,
  type SplitNode,
} from "@pi-studio-ui/features/workspace/pane-tree.js";

const CWD = "/work";

beforeEach(() => {
  useLayoutStore.setState({
    layouts: {},
    hydrationSources: { sessions: false, terminals: false },
    restoring: false,
    pendingActiveWorkspace: null,
  });
});

function layout(cwd = CWD): WorkspacePaneLayout {
  return useLayoutStore.getState().layouts[cwd]!;
}

/** Both restore sources reporting — the initial-hydration settle point. */
function hydrate(): void {
  useLayoutStore.getState().markHydrationSource("sessions");
  useLayoutStore.getState().markHydrationSource("terminals");
}

function paneIds(tree: PaneNode = layout().tree): string[] {
  return leafIds(tree);
}

function childIds(tree: PaneNode = layout().tree): string[] {
  return (tree as SplitNode).children.map((child) => leafIds(child)[0]!);
}

/** The three invariants every mutation must preserve. */
function assertInvariants(cwd = CWD): void {
  const current = useLayoutStore.getState().layouts[cwd];
  if (!current) return;
  const leaves = leafIds(current.tree);
  expect(new Set(leaves).size).toBe(leaves.length);
  // 3. focusedPaneId always names a leaf in the tree.
  expect(leaves).toContain(current.focusedPaneId);
  // 1. Every placed tab maps to exactly one leaf that exists.
  for (const paneId of Object.values(current.placement)) expect(leaves).toContain(paneId);
  // 2. Every active tab is placed in the pane it is active for.
  for (const [paneId, tabId] of Object.entries(current.activeByPane)) {
    expect(leaves).toContain(paneId);
    expect(current.placement[tabId]).toBe(paneId);
  }
}

/** Build `row[P0, column[P1, row[P2, P3]]]` — P2/P3 sit at the depth cap. */
function depthCappedLayout(): { p0: string; p1: string; p2: string; p3: string } {
  const store = useLayoutStore.getState();
  store.ensureWorkspace(CWD);
  const p0 = layout().focusedPaneId;
  const p1 = store.splitEmpty(CWD, p0, "right")!;
  const p2 = store.splitEmpty(CWD, p1, "bottom")!;
  const p3 = store.splitEmpty(CWD, p2, "right")!;
  return { p0, p1, p2, p3 };
}

// ─── ensureWorkspace ───────────────────────────────────────────────────────────────────────

describe("ensureWorkspace", () => {
  it("creates a single-leaf layout with that leaf focused", () => {
    useLayoutStore.getState().ensureWorkspace(CWD);
    const created = layout();
    expect(created.tree.kind).toBe("leaf");
    expect(paneIds()).toEqual([created.focusedPaneId]);
    expect(created.placement).toEqual({});
    expect(created.activeByPane).toEqual({});
    assertInvariants();
  });

  it("is a no-op on a workspace that already exists", () => {
    useLayoutStore.getState().ensureWorkspace(CWD);
    const first = layout();
    useLayoutStore.getState().ensureWorkspace(CWD);
    expect(layout()).toBe(first);
  });

  it("keeps workspaces independent", () => {
    useLayoutStore.getState().ensureWorkspace(CWD);
    useLayoutStore.getState().ensureWorkspace("/other");
    expect(layout().focusedPaneId).not.toBe(layout("/other").focusedPaneId);
  });
});

// ─── assignTab ─────────────────────────────────────────────────────────────────────────────

describe("assignTab", () => {
  it("lands in the focused pane and becomes its active tab", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const pane = layout().focusedPaneId;
    store.assignTab(CWD, "t1");

    expect(store.paneOfTab(CWD, "t1")).toBe(pane);
    expect(layout().activeByPane[pane]).toBe("t1");
    expect(store.activeTabOf(CWD)).toBe("t1");
    assertInvariants();
  });

  it("materializes the workspace on first touch", () => {
    useLayoutStore.getState().assignTab(CWD, "t1");
    expect(useLayoutStore.getState().paneOfTab(CWD, "t1")).toBe(layout().focusedPaneId);
  });

  it("honours an explicit pane and focuses it", () => {
    const store = useLayoutStore.getState();
    const { p0, p1 } = depthCappedLayout();
    store.focusPane(CWD, p0);
    store.assignTab(CWD, "t1", p1);

    expect(store.paneOfTab(CWD, "t1")).toBe(p1);
    expect(layout().focusedPaneId).toBe(p1);
    assertInvariants();
  });

  it("falls back to the focused pane when the requested pane is gone", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const pane = layout().focusedPaneId;
    store.assignTab(CWD, "t1", "pane-that-never-existed");
    expect(store.paneOfTab(CWD, "t1")).toBe(pane);
  });

  it("places in the background without changing the active tab or focus", () => {
    const store = useLayoutStore.getState();
    const { p0, p1 } = depthCappedLayout();
    store.focusPane(CWD, p0);
    store.assignTab(CWD, "t1", p0);
    store.assignTab(CWD, "t2", p1, true);

    expect(store.paneOfTab(CWD, "t2")).toBe(p1);
    expect(layout().activeByPane[p1]).toBeUndefined();
    expect(layout().focusedPaneId).toBe(p0);
    expect(store.activeTabOf(CWD)).toBe("t1");
    assertInvariants();
  });
});

// ─── splitWithTab ──────────────────────────────────────────────────────────────────────────

describe("splitWithTab", () => {
  it("puts the moved tab in a new pane on the dropped side and focuses it", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    store.assignTab(CWD, "t1", p0);
    store.assignTab(CWD, "t2", p0);

    store.splitWithTab(CWD, "t2", p0, "right", ["t1", "t2"]);

    const created = store.paneOfTab(CWD, "t2")!;
    expect(created).not.toBe(p0);
    expect(childIds()).toEqual([p0, created]); // `right` places the new pane after the target
    expect((layout().tree as SplitNode).direction).toBe("row");
    expect(layout().activeByPane[created]).toBe("t2");
    expect(layout().focusedPaneId).toBe(created);
    // The source pane falls back to its nearest remaining sibling.
    expect(layout().activeByPane[p0]).toBe("t1");
    assertInvariants();
  });

  it("places the new pane before the target for `left` and `top`", () => {
    for (const [region, direction] of [
      ["left", "row"],
      ["top", "column"],
    ] as const) {
      useLayoutStore.setState({ layouts: {} });
      const store = useLayoutStore.getState();
      store.ensureWorkspace(CWD);
      const p0 = layout().focusedPaneId;
      store.assignTab(CWD, "t1", p0);
      store.assignTab(CWD, "t2", p0);

      store.splitWithTab(CWD, "t2", p0, region, ["t1", "t2"]);

      const created = store.paneOfTab(CWD, "t2")!;
      expect(childIds()).toEqual([created, p0]);
      expect((layout().tree as SplitNode).direction).toBe(direction);
    }
  });

  it("is a no-op when the dragged tab is the target pane's only tab", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    store.assignTab(CWD, "t1", p0);
    const before = layout();

    store.splitWithTab(CWD, "t1", p0, "right", ["t1"]);
    expect(layout()).toBe(before);
  });

  it("is a no-op when the split is illegal", () => {
    const store = useLayoutStore.getState();
    const { p2 } = depthCappedLayout();
    store.assignTab(CWD, "t1", p2);
    store.assignTab(CWD, "t2", p2);
    const before = layout();

    // P2 sits at the depth cap; a perpendicular split would make it depth 5.
    store.splitWithTab(CWD, "t2", p2, "bottom", ["t1", "t2"]);
    expect(layout()).toBe(before);

    // Along the parent run's own direction it is still legal — a sibling insert.
    store.splitWithTab(CWD, "t2", p2, "right", ["t1", "t2"]);
    expect(layout()).not.toBe(before);
    assertInvariants();
  });

  it("is a no-op for an unknown target pane", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    store.assignTab(CWD, "t1");
    const before = layout();
    store.splitWithTab(CWD, "t1", "nope", "right");
    expect(layout()).toBe(before);
  });
});

// ─── splitEmpty ────────────────────────────────────────────────────────────────────────────

describe("splitEmpty", () => {
  it("returns a focused, empty pane a tab can then be opened into", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    store.assignTab(CWD, "t1", p0);

    const created = store.splitEmpty(CWD, p0, "bottom")!;
    expect(created).toBeTruthy();
    expect(layout().focusedPaneId).toBe(created);
    expect(childIds()).toEqual([p0, created]);
    expect((layout().tree as SplitNode).direction).toBe("column");
    expect(layout().activeByPane[created]).toBeUndefined();
    // Nothing moved, so the source pane keeps its tab and its active tab.
    expect(store.paneOfTab(CWD, "t1")).toBe(p0);
    expect(layout().activeByPane[p0]).toBe("t1");

    store.assignTab(CWD, "t2", created);
    expect(layout().activeByPane[created]).toBe("t2");
    expect(store.activeTabOf(CWD)).toBe("t2");
    assertInvariants();
  });

  it("returns null and changes nothing when the split is illegal", () => {
    const store = useLayoutStore.getState();
    const { p2 } = depthCappedLayout();
    const before = layout();

    expect(store.splitEmpty(CWD, p2, "bottom")).toBeNull();
    expect(layout()).toBe(before);
    expect(store.splitEmpty(CWD, "nope", "right")).toBeNull();
    expect(layout()).toBe(before);
  });

  it("keeps repeated same-direction splits in one flat run", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    let pane = layout().focusedPaneId;
    for (let i = 0; i < 3; i += 1) pane = store.splitEmpty(CWD, pane, "right")!;

    expect(paneIds()).toHaveLength(4);
    expect((layout().tree as SplitNode).children).toHaveLength(4);
    assertInvariants();
  });
});

// ─── moveTab ───────────────────────────────────────────────────────────────────────────────

describe("moveTab", () => {
  it("activates the tab in the target, focuses it, and collapses an emptied source", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    const p1 = store.splitEmpty(CWD, p0, "right")!;
    const p2 = store.splitEmpty(CWD, p1, "right")!;
    store.assignTab(CWD, "t1", p0);
    store.assignTab(CWD, "t2", p1);
    store.assignTab(CWD, "t3", p2);
    // row[p0, p1, p2] at [0.5, 0.25, 0.25]
    expect((layout().tree as SplitNode).sizes).toEqual([0.5, 0.25, 0.25]);

    store.moveTab(CWD, "t2", p0, ["t1", "t2", "t3"]);

    expect(store.paneOfTab(CWD, "t2")).toBe(p0);
    expect(layout().activeByPane[p0]).toBe("t2");
    expect(layout().focusedPaneId).toBe(p0);
    expect(paneIds()).toEqual([p0, p2]); // p1 emptied and collapsed
    expect(layout().activeByPane[p1]).toBeUndefined();

    // p1's 0.25 is redistributed proportionally: 0.5 : 0.25 becomes 2/3 : 1/3.
    const rects = paneRects(layout().tree);
    expect(rects.get(p0)!.width).toBeCloseTo(2 / 3, 9);
    expect(rects.get(p2)!.x).toBeCloseTo(2 / 3, 9);
    expect(rects.get(p2)!.width).toBeCloseTo(1 / 3, 9);
    assertInvariants();
  });

  it("keeps the source pane when other tabs remain, falling its active back by index", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    const p1 = store.splitEmpty(CWD, p0, "right")!;
    for (const id of ["t1", "t2", "t3"]) store.assignTab(CWD, id, p0);
    store.assignTab(CWD, "t4", p1);
    store.setActiveTab(CWD, p0, "t2");

    store.moveTab(CWD, "t2", p1, ["t1", "t2", "t3", "t4"]);

    expect(paneIds()).toEqual([p0, p1]);
    // t2 sat at index 1 of [t1, t2, t3]; the remainder is [t1, t3], so index 1 -> t3.
    expect(layout().activeByPane[p0]).toBe("t3");
    expect(layout().activeByPane[p1]).toBe("t2");
    assertInvariants();
  });

  it("is a no-op into the pane the tab already occupies, for an unplaced tab, and for a dead pane", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    store.assignTab(CWD, "t1", p0);
    const before = layout();

    store.moveTab(CWD, "t1", p0);
    store.moveTab(CWD, "never-opened", p0);
    store.moveTab(CWD, "t1", "nope");
    expect(layout()).toBe(before);
  });
});

// ─── removeTab ─────────────────────────────────────────────────────────────────────────────

describe("removeTab", () => {
  it("removes an emptied pane and moves focus to a survivor", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    const p1 = store.splitEmpty(CWD, p0, "right")!;
    store.assignTab(CWD, "t1", p0);
    store.assignTab(CWD, "t2", p1);
    expect(layout().focusedPaneId).toBe(p1);

    store.removeTab(CWD, "t2", ["t1", "t2"]);

    expect(paneIds()).toEqual([p0]);
    expect(layout().tree.kind).toBe("leaf");
    expect(layout().focusedPaneId).toBe(p0);
    expect(layout().activeByPane[p1]).toBeUndefined();
    expect(store.activeTabOf(CWD)).toBe("t1");
    assertInvariants();
  });

  it("falls the pane's active tab back to its nearest remaining sibling", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    for (const id of ["t1", "t2", "t3"]) store.assignTab(CWD, id, p0);
    store.setActiveTab(CWD, p0, "t2");

    store.removeTab(CWD, "t2", ["t1", "t2", "t3"]);
    expect(layout().activeByPane[p0]).toBe("t3");

    store.removeTab(CWD, "t3", ["t1", "t3"]);
    expect(layout().activeByPane[p0]).toBe("t1");
    assertInvariants();
  });

  it("keeps the single-leaf tree when the only pane's last tab closes", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    store.assignTab(CWD, "t1", p0);

    store.removeTab(CWD, "t1", ["t1"]);

    expect(layout().tree).toEqual({ kind: "leaf", id: p0 });
    expect(layout().focusedPaneId).toBe(p0);
    expect(layout().placement).toEqual({});
    expect(layout().activeByPane).toEqual({});
    expect(store.activeTabOf(CWD)).toBeNull();
  });

  it("is a no-op for a tab that was never placed", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const before = layout();
    store.removeTab(CWD, "never-opened");
    expect(layout()).toBe(before);
  });
});

// ─── focusPane / setActiveTab ──────────────────────────────────────────────────────────────

describe("focusPane and setActiveTab", () => {
  it("setActiveTab changes a pane's active tab without focusing it", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    const p1 = store.splitEmpty(CWD, p0, "right")!;
    store.assignTab(CWD, "t1", p0);
    store.assignTab(CWD, "t2", p1, true);
    store.focusPane(CWD, p0);

    store.setActiveTab(CWD, p1, "t2");

    expect(layout().activeByPane[p1]).toBe("t2");
    expect(layout().focusedPaneId).toBe(p0);
    // A tab visible in a non-focused pane is not the workspace-active tab.
    expect(store.activeTabOf(CWD)).toBe("t1");
    assertInvariants();
  });

  it("setActiveTab refuses a tab that is not in the pane", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    const p1 = store.splitEmpty(CWD, p0, "right")!;
    store.assignTab(CWD, "t1", p0);
    const before = layout();

    store.setActiveTab(CWD, p1, "t1");
    expect(layout()).toBe(before);
  });

  it("focusPane refuses a pane that is not in the tree and is idempotent", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    const before = layout();

    store.focusPane(CWD, "nope");
    store.focusPane(CWD, p0);
    expect(layout()).toBe(before);
  });
});

// ─── resizeDivider ─────────────────────────────────────────────────────────────────────────

describe("resizeDivider", () => {
  it("delegates to resizeAtDivider and leaves non-adjacent siblings untouched", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    const p1 = store.splitEmpty(CWD, p0, "right")!;
    store.splitEmpty(CWD, p1, "right");
    expect((layout().tree as SplitNode).sizes).toEqual([0.5, 0.25, 0.25]);

    store.resizeDivider(CWD, [], 1, 0.1);

    const sizes = (layout().tree as SplitNode).sizes;
    expect(sizes[0]).toBe(0.5);
    expect(sizes[1]).toBeCloseTo(0.35, 9);
    expect(sizes[2]).toBeCloseTo(0.15, 9);
  });

  it("is a no-op for a clamped or invalid drag", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    store.splitEmpty(CWD, p0, "right");
    store.resizeDivider(CWD, [], 0, 0.9); // clamps at the minimum
    expect((layout().tree as SplitNode).sizes[1]).toBeCloseTo(0.1, 9);

    const clamped = layout();
    store.resizeDivider(CWD, [], 0, 0.9); // nothing left to give
    store.resizeDivider(CWD, [], 7, 0.1);
    expect(layout()).toBe(clamped);
  });
});

// ─── Invariants under interleaving ─────────────────────────────────────────────────────────

describe("invariants under interleaved operations", () => {
  it("holds across a deterministic pseudo-random operation sequence", () => {
    const store = useLayoutStore.getState();
    store.ensureWorkspace(CWD);
    const tabs = ["t1", "t2", "t3", "t4", "t5", "t6"];
    const regions = ["left", "right", "top", "bottom"] as const;
    let seed = 12345;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };

    for (let step = 0; step < 400; step += 1) {
      const panes = paneIds();
      const tab = tabs[next(tabs.length)]!;
      const pane = panes[next(panes.length)]!;
      const region = regions[next(regions.length)]!;
      switch (next(7)) {
        case 0:
          store.assignTab(CWD, tab, pane, next(2) === 0, tabs);
          break;
        case 1:
          store.moveTab(CWD, tab, pane, tabs);
          break;
        case 2:
          store.splitWithTab(CWD, tab, pane, region, tabs);
          break;
        case 3:
          store.splitEmpty(CWD, pane, region);
          break;
        case 4:
          store.removeTab(CWD, tab, tabs);
          break;
        case 5:
          store.focusPane(CWD, pane);
          break;
        default:
          store.setActiveTab(CWD, pane, tab);
          break;
      }
      assertInvariants();
      expect(paneIds().length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ─── Restore: claims, settle point, pruning ────────────────────────────────────────────────

describe("restoring a persisted layout", () => {
  const FRESH = { layouts: {}, hydrationSources: { sessions: false, terminals: false } };

  /** A persisted two-pane row: P0 holds `agent:s1`, P1 holds `agent:s2`, P1 was focused. */
  function persisted(
    overrides: Partial<ValidatedWorkspaceLayout> = {},
  ): Map<string, ValidatedWorkspaceLayout> {
    return new Map([
      [
        CWD,
        {
          tree: {
            kind: "split",
            direction: "row",
            children: [
              { kind: "leaf", id: "P0" },
              { kind: "leaf", id: "P1" },
            ],
            sizes: [0.5, 0.5],
          },
          placement: { "agent:s1": "P0", "agent:s2": "P1" },
          activeByPane: { P0: "agent:s1", P1: "agent:s2" },
          activePaneId: "P1",
          ...overrides,
        } satisfies ValidatedWorkspaceLayout,
      ],
    ]);
  }

  /** A restored tab arriving: `tab-store.open` will call exactly this in sprint-049. */
  function arrive(tabId: string, identity: string): void {
    useLayoutStore.getState().claimPaneFor(CWD, tabId, identity);
  }

  it("installs geometry and focus up front, before any tab arrives", () => {
    useLayoutStore.getState().installPersistedLayouts(persisted());
    expect(paneIds()).toEqual(["P0", "P1"]);
    expect(layout().focusedPaneId).toBe("P1");
    expect(layout().placement).toEqual({});
    assertInvariants();
  });

  it("falls focus back to the first leaf when activePaneId is absent", () => {
    useLayoutStore.getState().installPersistedLayouts(persisted({ activePaneId: null }));
    expect(layout().focusedPaneId).toBe("P0");
  });

  it("reaches the same final state whichever order the tabs arrive in", () => {
    const outcomes = [
      ["chat-s1", "chat-s2"],
      ["chat-s2", "chat-s1"],
    ].map((order) => {
      useLayoutStore.setState(FRESH);
      useLayoutStore.getState().installPersistedLayouts(persisted());
      for (const tabId of order) arrive(tabId, tabId === "chat-s1" ? "agent:s1" : "agent:s2");
      assertInvariants();
      const { tree, placement, activeByPane, focusedPaneId } = layout();
      return { tree, placement, activeByPane, focusedPaneId };
    });

    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[0]!.placement).toEqual({ "chat-s1": "P0", "chat-s2": "P1" });
    expect(outcomes[0]!.activeByPane).toEqual({ P0: "chat-s1", P1: "chat-s2" });
    expect(outcomes[0]!.focusedPaneId).toBe("P1");
  });

  it("gives a pane to the identity its record names, whichever arrives first", () => {
    // P1 wants agent:s2, but agent:s3 claims P1 too.
    for (const order of [
      ["chat-s3", "chat-s2"],
      ["chat-s2", "chat-s3"],
    ]) {
      useLayoutStore.setState(FRESH);
      useLayoutStore
        .getState()
        .installPersistedLayouts(persisted({ placement: { "agent:s2": "P1", "agent:s3": "P1" } }));
      for (const tabId of order) arrive(tabId, tabId === "chat-s2" ? "agent:s2" : "agent:s3");

      expect(layout().placement).toEqual({ "chat-s2": "P1", "chat-s3": "P1" });
      expect(layout().activeByPane.P1).toBe("chat-s2"); // the record's choice wins either way
      assertInvariants();
    }
  });

  it("never displaces a tab the user activated mid-restore", () => {
    useLayoutStore.getState().installPersistedLayouts(persisted());
    // The user opens something into P1 themselves while restore is still in flight.
    useLayoutStore.getState().assignTab(CWD, "file-x", "P1");
    expect(layout().activeByPane.P1).toBe("file-x");

    arrive("chat-s2", "agent:s2"); // P1's persisted active tab finally shows up

    expect(useLayoutStore.getState().paneOfTab(CWD, "chat-s2")).toBe("P1");
    expect(layout().activeByPane.P1).toBe("file-x"); // joined the pane, did not take it over
    assertInvariants();
  });

  it("does not move focus when a claimed tab arrives", () => {
    useLayoutStore.getState().installPersistedLayouts(persisted());
    expect(layout().focusedPaneId).toBe("P1");
    arrive("chat-s1", "agent:s1"); // lands in P0
    expect(layout().focusedPaneId).toBe("P1");
  });

  it("falls an unclaimed identity back to the focused pane", () => {
    useLayoutStore.getState().installPersistedLayouts(persisted());
    arrive("chat-s9", "agent:s9"); // no claim for this identity
    expect(useLayoutStore.getState().paneOfTab(CWD, "chat-s9")).toBe("P1");
    expect(layout().activeByPane.P1).toBe("chat-s9");
  });

  it("an unclaimed arrival during restore never steals a pane a claim already placed something in", () => {
    // The exact bug reported live: two independent restore hooks (chat, terminal) race in
    // undefined order. A terminal with no claim for it must not silently replace the chat a claim
    // correctly placed into the same (focused) pane moments earlier in the same restore pass.
    useLayoutStore.getState().installPersistedLayouts(persisted());
    arrive("chat-s2", "agent:s2"); // claimed into P1 (the focused pane), activates it
    expect(layout().activeByPane.P1).toBe("chat-s2");

    arrive("term-9", "terminal:9"); // unclaimed — no pane is waiting for this identity

    // Placed (so it isn't lost — surfacing an orphaned terminal is still the point), but P1's
    // active tab and focus stay exactly where the claim put them.
    expect(useLayoutStore.getState().paneOfTab(CWD, "term-9")).toBe("P1");
    expect(layout().activeByPane.P1).toBe("chat-s2");
  });

  it("the restore-time guard lifts once hydration settles — a later unclaimed open behaves normally", () => {
    useLayoutStore.getState().installPersistedLayouts(persisted());
    arrive("chat-s2", "agent:s2");
    hydrate(); // settle point reached; `restoring` flips back to false

    // A live "+"/Ctrl+T open into the focused pane after restore has finished must still take it
    // over immediately — the ordinary, expected behaviour this guard must not regress.
    arrive("term-9", "terminal:9");
    expect(layout().activeByPane.P1).toBe("term-9");
  });

  it("falls back when a claim names a pane absent from the tree", () => {
    useLayoutStore
      .getState()
      .installPersistedLayouts(persisted({ placement: { "agent:s1": "ghost" } }));
    arrive("chat-s1", "agent:s1");
    expect(useLayoutStore.getState().paneOfTab(CWD, "chat-s1")).toBe("P1");
  });

  it("honours an explicit pane over a pending claim", () => {
    useLayoutStore.getState().installPersistedLayouts(persisted());
    useLayoutStore.getState().claimPaneFor(CWD, "chat-s1", "agent:s1", "P1");
    expect(useLayoutStore.getState().paneOfTab(CWD, "chat-s1")).toBe("P1");
    // An explicit open is a user action: it takes focus and the pane's active slot.
    expect(layout().focusedPaneId).toBe("P1");
    expect(layout().activeByPane.P1).toBe("chat-s1");
  });

  it("never prunes a pane with an outstanding claim before the settle point", () => {
    useLayoutStore.getState().installPersistedLayouts(persisted());
    arrive("chat-s1", "agent:s1"); // only P0's claim is consumed so far

    // Closing the one tab that did arrive must not take P0 down while P1 is still expected.
    useLayoutStore.getState().removeTab(CWD, "chat-s1");
    expect(paneIds()).toEqual(["P0", "P1"]);

    arrive("chat-s2", "agent:s2");
    useLayoutStore.getState().removeTab(CWD, "chat-s2");
    expect(paneIds()).toEqual(["P0", "P1"]);
    assertInvariants();
  });

  it("discards unconsumed claims and prunes unclaimed panes once hydration completes", () => {
    useLayoutStore.getState().installPersistedLayouts(persisted());
    arrive("chat-s1", "agent:s1");

    useLayoutStore.getState().markHydrationSource("sessions");
    expect(paneIds()).toEqual(["P0", "P1"]); // one source is not enough

    useLayoutStore.getState().markHydrationSource("terminals");

    expect(paneIds()).toEqual(["P0"]);
    expect(layout().tree.kind).toBe("leaf");
    expect(layout().pendingPlacement).toEqual({});
    expect(layout().pendingActive).toEqual({});
    expect(layout().focusedPaneId).toBe("P0"); // focus followed the surviving pane
    assertInvariants();
  });

  it("is idempotent per source and prunes nothing that is occupied", () => {
    useLayoutStore.getState().installPersistedLayouts(persisted());
    arrive("chat-s1", "agent:s1");
    arrive("chat-s2", "agent:s2");
    hydrate();
    useLayoutStore.getState().markHydrationSource("sessions");

    expect(paneIds()).toEqual(["P0", "P1"]);
    expect(layout().activeByPane).toEqual({ P0: "chat-s1", P1: "chat-s2" });
  });

  it("gives a pane holding tabs but no active tab one at the settle point", () => {
    useLayoutStore.getState().installPersistedLayouts(persisted());
    arrive("chat-s2", "agent:s2");
    // Force the blank-pane case the wanted-identity rule can produce transiently.
    useLayoutStore.setState((s) => ({
      layouts: { ...s.layouts, [CWD]: { ...s.layouts[CWD]!, activeByPane: {} } },
    }));

    hydrate();

    expect(paneIds()).toEqual(["P1"]);
    expect(layout().activeByPane.P1).toBe("chat-s2");
    assertInvariants();
  });

  it("captures the workspace that was in view, and clears it at the settle point", () => {
    // `use-session-restore` reads this to seed the sidebar's expanded group and the explorer root:
    // re-reading storage later is unsafe, because a mid-restore write persists whatever workspace is
    // in view *at that moment* and would clobber the target.
    useLayoutStore.getState().installPersistedLayouts(persisted(), CWD);
    expect(useLayoutStore.getState().pendingActiveWorkspace).toBe(CWD);

    arrive("chat-s1", "agent:s1");
    arrive("chat-s2", "agent:s2");
    hydrate();

    expect(useLayoutStore.getState().pendingActiveWorkspace).toBeNull();
  });

  it("refuses a named workspace whose entry did not survive validation", () => {
    // The record named a workspace, but its geometry was dropped — so there is nothing to head for,
    // and restore must fall back to its own default rather than expanding an absent workspace.
    useLayoutStore.getState().installPersistedLayouts(persisted(), "/gone");
    expect(useLayoutStore.getState().pendingActiveWorkspace).toBeNull();
  });

  it("is null when nothing was persisted", () => {
    useLayoutStore.getState().installPersistedLayouts(new Map());
    expect(useLayoutStore.getState().pendingActiveWorkspace).toBeNull();
  });

  it("degrades to the single-pane default with no persisted state", () => {
    useLayoutStore.getState().installPersistedLayouts(new Map());
    useLayoutStore.getState().ensureWorkspace(CWD);
    const p0 = layout().focusedPaneId;
    arrive("chat-s1", "agent:s1");
    hydrate();

    expect(paneIds()).toEqual([p0]);
    expect(layout().activeByPane[p0]).toBe("chat-s1");
    expect(useLayoutStore.getState().activeTabOf(CWD)).toBe("chat-s1");
    assertInvariants();
  });

  it("resets the hydration cycle on a fresh install", () => {
    useLayoutStore.getState().installPersistedLayouts(persisted());
    hydrate();
    expect(useLayoutStore.getState().hydrationSources).toEqual({
      sessions: true,
      terminals: true,
    });

    useLayoutStore.getState().installPersistedLayouts(persisted());
    expect(useLayoutStore.getState().hydrationSources).toEqual({
      sessions: false,
      terminals: false,
    });
    expect(paneIds()).toEqual(["P0", "P1"]);
  });
});
