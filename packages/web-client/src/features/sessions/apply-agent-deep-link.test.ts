import { beforeEach, describe, expect, it } from "vitest";
import { applyAgentDeepLink, type AgentDeepLinkDeps } from "@pi-studio-ui/lib/agent-deep-link.js";
import { useDeepLinkStore } from "@pi-studio-ui/stores/deep-link-store.js";
import { useSessionStore, type SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { tabIds, useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { EMPTY_TIMELINE } from "@pi-studio-ui/timeline/reducer.js";
import {
  resetLayoutStore,
  resetSessionStore,
  resetTabStore,
} from "@pi-studio-ui/test/reset-stores.js";
import { openChatTab } from "./open-chat-tab.js";

function entry(id: string, agentId: string): SessionEntry {
  return {
    id,
    agentId,
    title: id,
    status: "idle",
    cwd: "/work",
    timeline: EMPTY_TIMELINE,
    userMessageCount: 0,
  };
}

interface Recorder {
  notFound: string[];
  urlReplaced: number;
  deps: AgentDeepLinkDeps<SessionEntry>;
}

function recorder(): Recorder {
  const r: Recorder = {
    notFound: [],
    urlReplaced: 0,
    deps: {
      consume: () => useDeepLinkStore.getState().consume(),
      findByAgentId: (id) => useSessionStore.getState().findByAgentId(id),
      select(session) {
        useSessionStore.getState().activate(session.id);
        openChatTab(session, null);
      },
      notifyNotFound: (id) => r.notFound.push(id),
      replaceUrl: () => {
        r.urlReplaced += 1;
      },
    },
  };
  return r;
}

beforeEach(() => {
  resetTabStore();
  resetLayoutStore();
  resetSessionStore();
  useDeepLinkStore.setState({ pendingAgentId: undefined, restored: false });
});

describe("applyAgentDeepLink", () => {
  it("selects a known agent over the most recent one and cleans the URL", () => {
    useSessionStore.getState().hydrate(entry("s-old", "old"));
    useSessionStore.getState().hydrate(entry("s-new", "new"));
    useSessionStore.getState().activate("s-new");
    openChatTab(entry("s-new", "new"), null);
    useDeepLinkStore.getState().set("old");
    const r = recorder();
    applyAgentDeepLink(r.deps);
    expect(useSessionStore.getState().activeSessionId).toBe("s-old");
    expect(useTabStore.getState().activeTabId).toBe(tabIds.chat("s-old"));
    expect(r.notFound).toEqual([]);
    expect(r.urlReplaced).toBe(1);
  });

  it("opens no duplicate tab when the chat is already open", () => {
    useSessionStore.getState().hydrate(entry("s-a", "a"));
    openChatTab(entry("s-a", "a"), null);
    useDeepLinkStore.getState().set("a");
    applyAgentDeepLink(recorder().deps);
    expect(useTabStore.getState().tabs.filter((t) => t.id === tabIds.chat("s-a"))).toHaveLength(1);
  });

  it("reports an unknown agent once and changes nothing", () => {
    useSessionStore.getState().hydrate(entry("s-a", "a"));
    useSessionStore.getState().activate("s-a");
    useDeepLinkStore.getState().set("nope");
    const r = recorder();
    applyAgentDeepLink(r.deps);
    expect(r.notFound).toEqual(["nope"]);
    expect(useSessionStore.getState().activeSessionId).toBe("s-a");
    expect(useTabStore.getState().tabs).toHaveLength(0);
    expect(r.urlReplaced).toBe(1);
  });

  it("never re-applies a consumed target and does nothing when none is pending", () => {
    useSessionStore.getState().hydrate(entry("s-a", "a"));
    useDeepLinkStore.getState().set("a");
    const r = recorder();
    applyAgentDeepLink(r.deps);
    applyAgentDeepLink(r.deps);
    expect(r.urlReplaced).toBe(1);
  });

  it("keeps a never-connected target pending", () => {
    useDeepLinkStore.getState().set("a");
    expect(useDeepLinkStore.getState().pendingAgentId).toBe("a");
  });

  it("the deep-link tab is the focused pane's active tab after hydration settles", () => {
    useSessionStore.getState().hydrate(entry("s-a", "a"));
    useSessionStore.getState().hydrate(entry("s-b", "b"));
    openChatTab(entry("s-b", "b"), null);
    useLayoutStore.getState().markHydrationSource("sessions");
    useLayoutStore.getState().markHydrationSource("terminals");
    expect(useLayoutStore.getState().restoring).toBe(false);
    useDeepLinkStore.getState().set("a");
    applyAgentDeepLink(recorder().deps);
    expect(useTabStore.getState().activeTabId).toBe(tabIds.chat("s-a"));
  });
});
