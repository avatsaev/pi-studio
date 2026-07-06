import { describe, it, expect } from "vitest";
import {
  resumeCommandFor,
  agentIdForTab,
  clipboardPayloadFor,
  tabIdsToClose,
  mergeTabLabels,
  migrateTabLabels,
  TabLabelsStore,
} from "./tab-actions.js";
import { createMemoryLayoutStorage } from "./layout-store.js";
import type { WorkspaceTab } from "./tabs.js";

function agentTab(agentId: string): WorkspaceTab {
  return { tabId: `agent:${agentId}`, target: { kind: "agent", agentId }, createdAt: 0 };
}
function terminalTab(id: string): WorkspaceTab {
  return { tabId: `terminal:${id}`, target: { kind: "terminal", terminalId: id }, createdAt: 0 };
}

describe("resume command / agent id", () => {
  it("builds the resume command", () => {
    expect(resumeCommandFor("a1")).toBe("pi-studio agent attach a1");
  });
  it("extracts the agent id for agent tabs only", () => {
    expect(agentIdForTab(agentTab("a1"))).toBe("a1");
    expect(agentIdForTab(terminalTab("t1"))).toBeUndefined();
  });
});

describe("clipboardPayloadFor", () => {
  it("copy-resume yields the resume command", () => {
    expect(clipboardPayloadFor("copy-resume", { agentId: "a1" })).toEqual({
      text: "pi-studio agent attach a1",
      toast: "Resume command copied",
    });
  });
  it("copy-agent-id yields the id", () => {
    expect(clipboardPayloadFor("copy-agent-id", { agentId: "a1" })).toEqual({
      text: "a1",
      toast: "Agent id copied",
    });
  });
  it("returns null for non-copy actions or when no agent", () => {
    expect(clipboardPayloadFor("reload-agent", { agentId: "a1" })).toBeNull();
    expect(clipboardPayloadFor("copy-resume", {})).toBeNull();
  });
});

describe("tabIdsToClose", () => {
  const order = ["t0", "t1", "t2", "t3"];
  it("close → just the target", () => {
    expect(tabIdsToClose("close", order, "t1")).toEqual(["t1"]);
  });
  it("close-others → everything but the target", () => {
    expect(tabIdsToClose("close-others", order, "t1")).toEqual(["t0", "t2", "t3"]);
  });
  it("close-left/above → tabs before index", () => {
    expect(tabIdsToClose("close-left", order, "t2")).toEqual(["t0", "t1"]);
    expect(tabIdsToClose("close-above", order, "t2")).toEqual(["t0", "t1"]);
  });
  it("close-right/below → tabs after index", () => {
    expect(tabIdsToClose("close-right", order, "t1")).toEqual(["t2", "t3"]);
    expect(tabIdsToClose("close-below", order, "t1")).toEqual(["t2", "t3"]);
  });
  it("unknown action or missing tab → empty", () => {
    expect(tabIdsToClose("rename", order, "t1")).toEqual([]);
    expect(tabIdsToClose("close", order, "ghost")).toEqual([]);
  });
});

describe("mergeTabLabels", () => {
  it("applies labels only where present", () => {
    const merged = mergeTabLabels([agentTab("a1"), terminalTab("t1")], { "agent:a1": "My agent" });
    expect(merged[0]!.label).toBe("My agent");
    expect(merged[1]!.label).toBeUndefined();
  });
});

describe("migrateTabLabels", () => {
  it("keeps valid string labels and drops garbage", () => {
    expect(migrateTabLabels({ version: 1, labels: { a: "x", b: 3 } })).toEqual({ version: 1, labels: { a: "x" } });
    expect(migrateTabLabels(null)).toEqual({ version: 1, labels: {} });
    expect(migrateTabLabels("nope")).toEqual({ version: 1, labels: {} });
  });
});

describe("TabLabelsStore", () => {
  it("persists renames across reloads and clears on empty", () => {
    const storage = createMemoryLayoutStorage();
    const store = new TabLabelsStore(storage);
    store.rename("s1", "w1", "agent:a1", "Renamed");

    // Fresh store over the same storage — simulates reload.
    const reloaded = new TabLabelsStore(storage);
    expect(reloaded.load("s1", "w1").labels["agent:a1"]).toBe("Renamed");

    // Clearing removes it.
    reloaded.rename("s1", "w1", "agent:a1", "   ");
    expect(reloaded.load("s1", "w1").labels["agent:a1"]).toBeUndefined();
  });

  it("scopes labels per workspace", () => {
    const storage = createMemoryLayoutStorage();
    const store = new TabLabelsStore(storage);
    store.rename("s1", "w1", "t", "one");
    store.rename("s1", "w2", "t", "two");
    expect(store.load("s1", "w1").labels["t"]).toBe("one");
    expect(store.load("s1", "w2").labels["t"]).toBe("two");
  });
});
