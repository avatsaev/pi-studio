import { beforeEach, describe, expect, it } from "vitest";
import { useTabStore, type Tab } from "./tab-store.js";
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
