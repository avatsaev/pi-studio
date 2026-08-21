import { beforeEach, describe, expect, it } from "vitest";
import { isTerminalsUpdate, reconcileLiveTerminals } from "./use-terminal-exit-watch.js";
import { useTabStore, type Tab } from "@pi-studio-ui/stores/tab-store.js";
import { resetTabStore } from "@pi-studio-ui/test/reset-stores.js";

beforeEach(() => {
  resetTabStore();
});

function terminalTab(id: string, slot: number | null, exited?: boolean): Tab {
  return {
    id,
    kind: "terminal",
    label: id,
    closable: true,
    data: { slot, cwd: "/work", ...(exited !== undefined ? { exited } : {}) },
    workspaceCwd: "/work",
  };
}

function chatTab(id: string): Tab {
  return {
    id,
    kind: "chat",
    label: id,
    closable: true,
    data: { sessionId: id },
    workspaceCwd: "/work",
  };
}

describe("isTerminalsUpdate", () => {
  it("accepts a well-formed terminals_update message", () => {
    expect(isTerminalsUpdate({ type: "terminals_update", terminals: [{ slot: 1 }] })).toBe(true);
    expect(isTerminalsUpdate({ type: "terminals_update", terminals: [] })).toBe(true);
  });

  it("accepts entries carrying cols/rows (sprint-053/task-007's resize broadcast)", () => {
    expect(
      isTerminalsUpdate({
        type: "terminals_update",
        terminals: [{ slot: 1, cols: 190, rows: 50 }],
      }),
    ).toBe(true);
  });

  it("rejects other message types, missing/malformed terminals, and non-objects", () => {
    expect(isTerminalsUpdate({ type: "agent_update" })).toBe(false);
    expect(isTerminalsUpdate({ type: "terminals_update" })).toBe(false);
    expect(isTerminalsUpdate({ type: "terminals_update", terminals: "nope" })).toBe(false);
    expect(isTerminalsUpdate(null)).toBe(false);
    expect(isTerminalsUpdate(undefined)).toBe(false);
    expect(isTerminalsUpdate("terminals_update")).toBe(false);
  });
});

describe("reconcileLiveTerminals", () => {
  it("marks a terminal tab exited once its slot is absent from the live set", () => {
    useTabStore.setState({ tabs: [terminalTab("t1", 5)] });
    reconcileLiveTerminals(new Set([]));
    expect((useTabStore.getState().tabs[0]!.data as { exited?: boolean }).exited).toBe(true);
  });

  it("never marks a still-live terminal exited — including right after a DIFFERENT one exits", () => {
    useTabStore.setState({ tabs: [terminalTab("survivor", 1), terminalTab("gone", 2)] });
    reconcileLiveTerminals(new Set([1])); // only slot 1 (survivor) is still in the daemon's list
    const tabs = useTabStore.getState().tabs;
    expect(
      (tabs.find((t) => t.id === "survivor")!.data as { exited?: boolean }).exited,
    ).toBeFalsy();
    expect((tabs.find((t) => t.id === "gone")!.data as { exited?: boolean }).exited).toBe(true);
  });

  it("never marks a tab with no slot yet exited (the create broadcast races create_terminal_response)", () => {
    useTabStore.setState({ tabs: [terminalTab("pending", null)] });
    reconcileLiveTerminals(new Set([])); // the daemon's list doesn't (yet) name this tab's slot
    expect((useTabStore.getState().tabs[0]!.data as { exited?: boolean }).exited).toBeFalsy();
  });

  it("ignores non-terminal tabs entirely", () => {
    useTabStore.setState({ tabs: [chatTab("c1")] });
    expect(() => reconcileLiveTerminals(new Set([]))).not.toThrow();
    expect(useTabStore.getState().tabs[0]!.data).toEqual({ sessionId: "c1" });
  });

  it("is a no-op for a tab already marked exited (sticky, no redundant write)", () => {
    useTabStore.setState({ tabs: [terminalTab("already-gone", 3, true)] });
    const before = useTabStore.getState().tabs[0];
    reconcileLiveTerminals(new Set([3])); // even if slot 3 somehow reappeared live
    const after = useTabStore.getState().tabs[0];
    expect(after).toBe(before); // same object reference — updateData was never called
    expect((after!.data as { exited?: boolean }).exited).toBe(true);
  });
});
