/**
 * PaneContentRouter logic tests — sprint-024 / task-002
 *
 * Tests the keepalive logic and tab state functions used by PaneContentRouter.
 * (React component rendering tested via DemoPage visual testing.)
 */

import { describe, it, expect } from "vitest";
import {
  mountedTabState,
  mountedHiddenStyle,
  nextMountedTabLru,
} from "../../workspace/keepalive.js";
import { createWorkspaceTab } from "../../workspace/tabs.js";

describe("keepalive — mountedTabState", () => {
  const lru = ["tab1", "tab2", "tab3"];

  it("returns 'active' for the active tab", () => {
    expect(mountedTabState("tab1", "tab1", lru)).toBe("active");
  });

  it("returns 'mounted-hidden' for backgrounded tab in LRU", () => {
    expect(mountedTabState("tab2", "tab1", lru)).toBe("mounted-hidden");
  });

  it("returns 'unmounted' for tab not in LRU", () => {
    expect(mountedTabState("tab99", "tab1", lru)).toBe("unmounted");
  });

  it("returns 'mounted-hidden' when activeTabId is undefined but tab in LRU", () => {
    expect(mountedTabState("tab1", undefined, lru)).toBe("mounted-hidden");
  });
});

describe("keepalive — mountedHiddenStyle", () => {
  it("active → display:contents, pointerEvents:auto", () => {
    const s = mountedHiddenStyle("active");
    expect(s.display).toBe("contents");
    expect(s.pointerEvents).toBe("auto");
  });

  it("mounted-hidden → pointerEvents:none", () => {
    const s = mountedHiddenStyle("mounted-hidden");
    expect(s.pointerEvents).toBe("none");
  });

  it("unmounted → display:none", () => {
    const s = mountedHiddenStyle("unmounted");
    expect(s.display).toBe("none");
  });
});

describe("keepalive — LRU eviction at cap 3", () => {
  it("caps LRU at 3 and evicts oldest", () => {
    let lru: string[] = [];
    lru = nextMountedTabLru(lru, "t1");
    lru = nextMountedTabLru(lru, "t2");
    lru = nextMountedTabLru(lru, "t3");
    lru = nextMountedTabLru(lru, "t4");
    expect(lru).toHaveLength(3);
    expect(lru).not.toContain("t1");
    expect(lru[0]).toBe("t4");
  });

  it("re-activating an existing tab brings it to front without growing LRU", () => {
    let lru = nextMountedTabLru([], "t1");
    lru = nextMountedTabLru(lru, "t2");
    lru = nextMountedTabLru(lru, "t3");
    lru = nextMountedTabLru(lru, "t2"); // re-activate t2
    expect(lru).toHaveLength(3);
    expect(lru[0]).toBe("t2");
    expect(lru).toContain("t1");
    expect(lru).toContain("t3");
  });
});

describe("createWorkspaceTab — target kinds for PaneContentRouter", () => {
  it("creates agent tab", () => {
    const tab = createWorkspaceTab({ kind: "agent", agentId: "a1" });
    expect(tab.target.kind).toBe("agent");
    expect(tab.tabId).toBe("agent_a1");
  });

  it("creates terminal tab", () => {
    const tab = createWorkspaceTab({ kind: "terminal", terminalId: "t1" });
    expect(tab.target.kind).toBe("terminal");
  });

  it("creates file tab", () => {
    const tab = createWorkspaceTab({ kind: "file", path: "/src/index.ts", lineStart: 10 });
    expect(tab.target.kind).toBe("file");
    if (tab.target.kind === "file") {
      expect(tab.target.lineStart).toBe(10);
    }
  });

  it("creates browser tab", () => {
    const tab = createWorkspaceTab({ kind: "browser", browserId: "b1" });
    expect(tab.target.kind).toBe("browser");
  });

  it("creates draft tab", () => {
    const tab = createWorkspaceTab({ kind: "draft", draftId: "d1", setup: { provider: "pi", cwd: "/home/user" } });
    expect(tab.target.kind).toBe("draft");
  });
});
