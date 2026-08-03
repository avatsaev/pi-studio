import { beforeEach, describe, expect, it } from "vitest";
import {
  occupiedPaneRects,
  paneChrome,
  paneDividers,
  panelBoxes,
  paneStyle,
  percent,
} from "./pane-layout-view.js";
import { createPaneLayout, useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { useTabStore, type Tab } from "@pi-studio-ui/stores/tab-store.js";
import { leafIds } from "./pane-tree.js";
import { resetLayoutStore, resetTabStore } from "@pi-studio-ui/test/reset-stores.js";

const CWD = "/work";

beforeEach(() => {
  resetTabStore();
  resetLayoutStore();
});

function chatTab(id: string, workspaceCwd = CWD): Tab {
  return { id, kind: "chat", label: id, closable: true, data: { sessionId: id }, workspaceCwd };
}

function layoutOf(cwd = CWD) {
  return useLayoutStore.getState().layouts[cwd]!;
}

/** Open `ids` in one pane, then split the pane rightwards moving the last id into the new pane. */
function twoPanes(ids: string[]): { left: string; right: string } {
  for (const id of ids) useTabStore.getState().open(chatTab(id));
  const left = layoutOf().focusedPaneId;
  useLayoutStore.getState().splitWithTab(CWD, ids.at(-1)!, left, "right", ids);
  const right = leafIds(layoutOf().tree).find((id) => id !== left)!;
  return { left, right };
}

describe("percent", () => {
  it("renders whole and fractional percentages without trailing zeros", () => {
    expect(percent(1)).toBe("100%");
    expect(percent(0.5)).toBe("50%");
    expect(percent(0)).toBe("0%");
    expect(percent(1 / 3)).toBe("33.3333%");
  });
});

describe("paneStyle", () => {
  it("insets a pane's body below its strip row", () => {
    expect(paneStyle({ x: 0.5, y: 0, width: 0.5, height: 1 })).toEqual({
      left: "50%",
      top: "calc(0% + var(--pane-strip-height))",
      width: "50%",
      height: "calc(100% - var(--pane-strip-height))",
    });
  });

  it("offsets a lower pane by both its own y and the strip", () => {
    expect(paneStyle({ x: 0, y: 0.5, width: 1, height: 0.5 })).toMatchObject({
      top: "calc(50% + var(--pane-strip-height))",
      height: "calc(50% - var(--pane-strip-height))",
    });
  });

  it("is undefined for a tab with no pane, so the stylesheet's full box stands", () => {
    // Not a 0×0 box: `Timeline.tsx`'s virtualizer skips measurement while hidden and would cache a
    // bogus zero height otherwise.
    expect(paneStyle(undefined)).toBeUndefined();
  });
});

describe("paneChrome", () => {
  it("gives a single pane one full-width strip and NO focus indicator", () => {
    useTabStore.getState().open(chatTab("chat-1"));
    const chrome = paneChrome(layoutOf());
    expect(chrome).toHaveLength(1);
    expect(chrome[0]!.stripStyle).toEqual({
      left: "0%",
      top: "0%",
      width: "100%",
      height: "var(--pane-strip-height)",
    });
    // A lone pane must look exactly like a workspace with no split support at all.
    expect(chrome[0]!.focused).toBe(false);
  });

  it("gives each pane its own strip and marks only the focused one", () => {
    const { left, right } = twoPanes(["chat-1", "chat-2"]);
    const chrome = paneChrome(layoutOf());
    expect(chrome.map((c) => c.paneId)).toEqual([left, right]);
    expect(chrome.map((c) => c.focused)).toEqual([false, true]);
    expect(chrome[1]!.stripStyle).toMatchObject({ left: "50%", width: "50%" });
  });

  it("has no chrome without a layout", () => {
    expect(paneChrome(undefined)).toEqual([]);
  });
});

describe("paneDividers", () => {
  it("finds none in a single pane", () => {
    useTabStore.getState().open(chatTab("chat-1"));
    expect(paneDividers(layoutOf())).toEqual([]);
  });

  it("finds N-1 boundaries carrying the split's own rect as the drag denominator", () => {
    twoPanes(["chat-1", "chat-2"]);
    const found = paneDividers(layoutOf());
    expect(found).toHaveLength(1);
    expect(found[0]!.direction).toBe("row");
    expect(found[0]!.rect).toEqual({ x: 0.5, y: 0, width: 0, height: 1 });
    expect(found[0]!.splitRect).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("offers none while a pane is unoccupied — the paths would address the wrong split", () => {
    useTabStore.getState().open(chatTab("chat-1"));
    // A restored-but-unclaimed pane: the effective tree is pruned, so its divider is not the
    // stored tree's divider and a drag would resize a split the user cannot see.
    useLayoutStore.getState().splitEmpty(CWD, layoutOf().focusedPaneId, "right");
    expect(paneDividers(layoutOf())).toEqual([]);
  });
});

describe("occupiedPaneRects", () => {
  it("gives a single-leaf layout the whole box", () => {
    useTabStore.getState().open(chatTab("chat-1"));
    const rects = occupiedPaneRects(layoutOf());
    expect([...rects.values()]).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);
  });

  it("splits complementary halves between two panes", () => {
    const { left, right } = twoPanes(["chat-1", "chat-2"]);
    const rects = occupiedPaneRects(layoutOf());
    expect(rects.get(left)).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
    expect(rects.get(right)).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
  });

  it("drops a pane that holds no tab yet, redistributing its fraction", () => {
    useTabStore.getState().open(chatTab("chat-1"));
    const source = layoutOf().focusedPaneId;
    // A split with no tab in the new pane — what a restore looks like before the claim arrives.
    const created = useLayoutStore.getState().splitEmpty(CWD, source, "right")!;

    const rects = occupiedPaneRects(layoutOf());
    expect(rects.has(created)).toBe(false);
    expect(rects.get(source)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    // The stored tree still holds both — pruning is the settle point's job, not geometry's.
    expect(leafIds(layoutOf().tree)).toHaveLength(2);
  });

  it("has no rects at all without a layout", () => {
    expect(occupiedPaneRects(undefined).size).toBe(0);
  });
});

describe("panelBoxes", () => {
  it("emits one entry per tab, in tab order, whatever the tree looks like", () => {
    twoPanes(["chat-1", "chat-2", "chat-3"]);
    const tabs = useTabStore.getState().tabs;

    const flat = panelBoxes(tabs, CWD, createPaneLayout());
    const split = panelBoxes(tabs, CWD, layoutOf());
    // The entry SET and ORDER are what React keys on — a rearrangement may only change styles.
    expect(split.map((b) => b.tabId)).toEqual(["chat-1", "chat-2", "chat-3"]);
    expect(flat.map((b) => b.tabId)).toEqual(split.map((b) => b.tabId));
    expect(split.map((b) => b.style)).not.toEqual(flat.map((b) => b.style));
  });

  it("shows both panes' active tabs at complementary rects simultaneously", () => {
    twoPanes(["chat-1", "chat-2"]);
    const boxes = panelBoxes(useTabStore.getState().tabs, CWD, layoutOf());
    expect(boxes.filter((b) => b.visible).map((b) => b.tabId)).toEqual(["chat-1", "chat-2"]);
    expect(boxes[0]!.style).toMatchObject({ left: "0%", width: "50%" });
    expect(boxes[1]!.style).toMatchObject({ left: "50%", width: "50%" });
  });

  it("keeps a non-focused pane's active tab visible while another pane holds the active tab", () => {
    const { left } = twoPanes(["chat-1", "chat-2"]);
    // chat-2 is in the focused pane; chat-1 is the unfocused pane's active tab.
    expect(useTabStore.getState().activeTabId).toBe("chat-2");
    expect(layoutOf().focusedPaneId).not.toBe(left);
    const visible = panelBoxes(useTabStore.getState().tabs, CWD, layoutOf()).filter(
      (b) => b.visible,
    );
    expect(visible.map((b) => b.tabId)).toContain("chat-1");
  });

  it("hides a pane's inactive tab and leaves the other pane's box untouched", () => {
    const { left, right } = twoPanes(["chat-1", "chat-2", "chat-3"]);
    // Two tabs share the left pane; activate the other one there.
    useTabStore.getState().activate("chat-1");
    const before = panelBoxes(useTabStore.getState().tabs, CWD, layoutOf());
    useTabStore.getState().activate("chat-2");
    const after = panelBoxes(useTabStore.getState().tabs, CWD, layoutOf());

    expect(before.map((b) => b.style)).toEqual(after.map((b) => b.style));
    expect(before.find((b) => b.tabId === "chat-1")!.visible).toBe(true);
    expect(after.find((b) => b.tabId === "chat-1")!.visible).toBe(false);
    expect(after.find((b) => b.tabId === "chat-2")!.visible).toBe(true);
    expect(layoutOf().placement["chat-3"]).toBe(right);
    expect(layoutOf().placement["chat-1"]).toBe(left);
  });

  it("hides every tab of a workspace that is not in view, without dropping its entry", () => {
    useTabStore.getState().open(chatTab("chat-a", "/work-a"));
    useTabStore.getState().open(chatTab("chat-b", "/work-b"));
    const tabs = useTabStore.getState().tabs;

    const boxes = panelBoxes(tabs, "/work-b", layoutOf("/work-b"));
    expect(boxes.map((b) => b.tabId)).toEqual(["chat-a", "chat-b"]);
    expect(boxes[0]).toEqual({ tabId: "chat-a", style: undefined, visible: false });
    expect(boxes[1]!.visible).toBe(true);
  });

  it("keeps every entry when no workspace is in view", () => {
    useTabStore.getState().open(chatTab("chat-1"));
    const boxes = panelBoxes(useTabStore.getState().tabs, null, undefined);
    expect(boxes).toEqual([{ tabId: "chat-1", style: undefined, visible: false }]);
  });

  it("survives a divider resize by changing only the two adjacent styles", () => {
    const { left, right } = twoPanes(["chat-1", "chat-2"]);
    const before = panelBoxes(useTabStore.getState().tabs, CWD, layoutOf());
    useLayoutStore.getState().resizeDivider(CWD, [], 0, 0.2);
    const after = panelBoxes(useTabStore.getState().tabs, CWD, layoutOf());

    expect(after.map((b) => b.tabId)).toEqual(before.map((b) => b.tabId));
    expect(occupiedPaneRects(layoutOf()).get(left)!.width).toBeCloseTo(0.7);
    expect(occupiedPaneRects(layoutOf()).get(right)!.width).toBeCloseTo(0.3);
    expect(after[0]!.style).toMatchObject({ width: "70%" });
    expect(after[1]!.style).toMatchObject({ left: "70%", width: "30%" });
  });
});
