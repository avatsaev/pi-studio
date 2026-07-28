import { beforeEach, describe, expect, it } from "vitest";
import { useTabStore, openNewMolecule, tabIds, type Tab } from "./tab-store.js";
import { useSessionStore } from "./session-store.js";

beforeEach(() => {
  useTabStore.setState({
    tabs: [],
    activeTabId: null,
    activeWorkspaceCwd: null,
    lastActiveTabByWorkspace: {},
  });
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
});

function chatTab(id: string, sessionId: string, workspaceCwd = "/work"): Tab {
  return { id, kind: "chat", label: id, closable: true, data: { sessionId }, workspaceCwd };
}

function terminalTab(id: string, workspaceCwd = "/work"): Tab {
  return {
    id,
    kind: "terminal",
    label: id,
    closable: true,
    data: { slot: null, cwd: workspaceCwd },
    workspaceCwd,
  };
}

describe("tab store — sidebar/session sync", () => {
  it("open()'ing a new chat tab activates its session, mirroring a sidebar click", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("activate() on a chat tab switches the sidebar's highlighted session to match", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    expect(useSessionStore.getState().activeSessionId).toBe("s2");

    useTabStore.getState().activate("chat-s1");
    expect(useTabStore.getState().activeTabId).toBe("chat-s1");
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("re-open()'ing an already-open chat tab (existing-tab branch) re-syncs the sidebar", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("activate() on a non-chat tab (terminal) leaves the sidebar's active session untouched", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(terminalTab("term-1"));
    useTabStore.getState().activate("term-1");
    expect(useTabStore.getState().activeTabId).toBe("term-1");
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("close()'ing the active chat tab syncs the sidebar to the sibling it falls back to", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    useTabStore.getState().close("chat-s2");
    expect(useTabStore.getState().activeTabId).toBe("chat-s1");
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("close()'ing a background (non-active) tab never touches the sidebar's active session", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    useTabStore.getState().close("chat-s1");
    expect(useTabStore.getState().activeTabId).toBe("chat-s2");
    expect(useSessionStore.getState().activeSessionId).toBe("s2");
  });

  it("switchWorkspace() restoring a remembered chat tab syncs the sidebar to match", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1", "/work-a"));
    useTabStore.getState().open(chatTab("chat-s2", "s2", "/work-b"));
    expect(useSessionStore.getState().activeSessionId).toBe("s2");

    useTabStore.getState().switchWorkspace("/work-a");
    expect(useTabStore.getState().activeTabId).toBe("chat-s1");
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });
});

describe("openNewMolecule", () => {
  it("opens an empty molecule tab with an incrementing label and the mol-new-<n> id shape", () => {
    openNewMolecule("/work");
    const tabs = useTabStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      id: tabIds.molecule("new-1"),
      kind: "molecule",
      label: "Molecule 1",
      closable: true,
      data: { path: null },
      workspaceCwd: "/work",
    });

    openNewMolecule("/work");
    const tabs2 = useTabStore.getState().tabs;
    expect(tabs2).toHaveLength(2);
    expect(tabs2[1]?.label).toBe("Molecule 2");
    expect(tabs2[1]?.id).not.toBe(tabs[0]?.id);
  });
});
