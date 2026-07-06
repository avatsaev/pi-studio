/**
 * Tests for navigation chrome logic — pure TS, no DOM.
 * app-navigation-screens.md § Left sidebar, § Command center
 * keyboard-shortcuts.md
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  sidebarMode,
  shouldStartEdgeSwipe,
  groupWorkspaces,
  commandCenterItems,
  commandCenterReducer,
  activateCommandCenterItem,
  STATIC_COMMAND_ACTIONS,
  getShortcutPlatform,
  resolveKeyboardFocusScope,
  DEFAULT_BINDINGS,
  KeyboardShortcutOverridesStore,
  type WorkspaceRow,
  type CommandCenterAgent,
  type CommandCenterState,
} from "./nav-logic.js";

// ---------------------------------------------------------------------------
// Sidebar mode derivation
// ---------------------------------------------------------------------------
describe("sidebarMode", () => {
  const profile = { id: "h1", serverId: "s1", label: "L", kind: "direct" as const, url: "ws://x", createdAtMs: 0 };
  const online = { profile, status: "online" as const, serverId: "s1", features: {}, reconnectAttempt: 0 };
  const offline = { ...online, status: "offline" as const };

  it("hidden when store not ready", () => {
    expect(sidebarMode({ path: "/h/s1", storeReady: false, hosts: [online], isCompact: false, focusMode: false })).toBe("hidden");
  });

  it("hidden when path has no known host", () => {
    expect(sidebarMode({ path: "/welcome", storeReady: true, hosts: [online], isCompact: false, focusMode: false })).toBe("hidden");
  });

  it("pinned when wide + ready + known host", () => {
    expect(sidebarMode({ path: "/h/s1", storeReady: true, hosts: [online], isCompact: false, focusMode: false })).toBe("pinned");
  });

  it("overlay when compact + ready + known host", () => {
    expect(sidebarMode({ path: "/h/s1", storeReady: true, hosts: [online], isCompact: true, focusMode: false })).toBe("overlay");
  });

  it("hidden in focus mode", () => {
    expect(sidebarMode({ path: "/h/s1", storeReady: true, hosts: [online], isCompact: false, focusMode: true })).toBe("hidden");
  });
});

// ---------------------------------------------------------------------------
// Edge swipe
// ---------------------------------------------------------------------------
describe("shouldStartEdgeSwipe", () => {
  it("returns false when not compact", () => {
    expect(shouldStartEdgeSwipe({ x: 10, dx: 20, dy: 2, isCompact: false })).toBe(false);
  });
  it("returns false when x > 32", () => {
    expect(shouldStartEdgeSwipe({ x: 33, dx: 20, dy: 2, isCompact: true })).toBe(false);
  });
  it("returns true when compact + x ≤ 32 + rightward gesture", () => {
    expect(shouldStartEdgeSwipe({ x: 10, dx: 20, dy: 2, isCompact: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Workspace grouping
// ---------------------------------------------------------------------------
describe("groupWorkspaces", () => {
  const rows: WorkspaceRow[] = [
    { workspaceId: "w1", label: "Alpha", projectKey: "proj-a", lastActivityMs: 100 },
    { workspaceId: "w2", label: "Beta",  projectKey: "proj-a", lastActivityMs: 200 },
    { workspaceId: "w3", label: "Gamma", projectKey: "proj-b", lastActivityMs: 50 },
  ];

  it("project grouping groups by projectKey", () => {
    const groups = groupWorkspaces(rows, "project");
    const keys = groups.map((g) => g.key);
    expect(keys).toContain("proj-a");
    expect(keys).toContain("proj-b");
    expect(groups.find((g) => g.key === "proj-a")!.rows).toHaveLength(2);
  });

  it("recent grouping sorts by lastActivityMs desc", () => {
    const groups = groupWorkspaces(rows, "recent");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows[0]!.workspaceId).toBe("w2"); // highest activity
  });
});

// ---------------------------------------------------------------------------
// Command center items
// ---------------------------------------------------------------------------
describe("commandCenterItems", () => {
  const agent: CommandCenterAgent = {
    serverId: "s1", agentId: "a1", title: "My agent", cwd: "/home/user/proj",
    status: "running", lastActivityMs: 9000, requiresAttention: false,
  };

  it("empty query returns all agents + static actions", () => {
    const items = commandCenterItems({ agents: [agent], query: "" });
    expect(items.some((i) => i.kind === "agent")).toBe(true);
    expect(items.some((i) => i.kind === "action")).toBe(true);
  });

  it("query filters agents by title", () => {
    const items = commandCenterItems({ agents: [agent], query: "My agent" });
    expect(items.filter((i) => i.kind === "agent")).toHaveLength(1);
  });

  it("query filters agents by cwd", () => {
    const items = commandCenterItems({ agents: [agent], query: "proj" });
    expect(items.filter((i) => i.kind === "agent")).toHaveLength(1);
  });

  it("non-matching query returns no agent but matching actions", () => {
    const items = commandCenterItems({ agents: [agent], query: "zzznomatch_home" });
    expect(items.filter((i) => i.kind === "agent")).toHaveLength(0);
  });

  it("attention agent sorts first", () => {
    const attention: CommandCenterAgent = { ...agent, agentId: "a2", status: "waiting", requiresAttention: true, lastActivityMs: 1 };
    const items = commandCenterItems({ agents: [agent, attention], query: "" });
    const agentItems = items.filter((i) => i.kind === "agent");
    expect(agentItems[0]!.kind === "agent" && (agentItems[0] as any).agent.agentId).toBe("a2");
  });
});

// ---------------------------------------------------------------------------
// Command center reducer
// ---------------------------------------------------------------------------
describe("commandCenterReducer", () => {
  const initial: CommandCenterState = { open: false, highlightedIndex: 0 };

  it("OPEN sets open=true, highlightedIndex=0", () => {
    const s = commandCenterReducer(initial, { type: "OPEN" });
    expect(s.open).toBe(true);
    expect(s.highlightedIndex).toBe(0);
  });

  it("CLOSE sets open=false", () => {
    const opened = { ...initial, open: true };
    expect(commandCenterReducer(opened, { type: "CLOSE" }).open).toBe(false);
  });

  it("ARROW_DOWN wraps around", () => {
    const opened = { open: true, highlightedIndex: 2 };
    const s = commandCenterReducer(opened, { type: "ARROW_DOWN", itemCount: 3 });
    expect(s.highlightedIndex).toBe(0);
  });

  it("ARROW_UP wraps around from 0", () => {
    const opened = { open: true, highlightedIndex: 0 };
    const s = commandCenterReducer(opened, { type: "ARROW_UP", itemCount: 3 });
    expect(s.highlightedIndex).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Shortcut dispatcher
// ---------------------------------------------------------------------------
describe("getShortcutPlatform", () => {
  it("mac UA → mac", () => {
    expect(getShortcutPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe("mac");
  });
  it("windows UA → non-mac", () => {
    expect(getShortcutPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("non-mac");
  });
});

// ---------------------------------------------------------------------------
// Shortcut overrides store
// ---------------------------------------------------------------------------
describe("KeyboardShortcutOverridesStore", () => {
  let store: KeyboardShortcutOverridesStore;

  beforeEach(() => {
    store = new KeyboardShortcutOverridesStore();
  });

  it("starts empty", () => {
    expect(Object.keys(store.getAll())).toHaveLength(0);
  });

  it("set and get round-trips", () => {
    store.set("toggle-command-center", "ctrl+k");
    expect(store.get("toggle-command-center")).toBe("ctrl+k");
  });

  it("remove deletes override", () => {
    store.set("new-agent", "ctrl+n");
    store.remove("new-agent");
    expect(store.get("new-agent")).toBeUndefined();
  });

  it("serialize/deserialize round-trips", () => {
    store.set("toggle-command-center", "ctrl+k");
    const json = store.serialize();
    const restored = KeyboardShortcutOverridesStore.deserialize(json);
    expect(restored.get("toggle-command-center")).toBe("ctrl+k");
  });

  it("resetAll clears all overrides", () => {
    store.set("a", "b");
    store.resetAll();
    expect(Object.keys(store.getAll())).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_BINDINGS sanity
// ---------------------------------------------------------------------------
describe("DEFAULT_BINDINGS", () => {
  it("contains toggle-command-center binding", () => {
    expect(DEFAULT_BINDINGS.some((b) => b.action === "toggle-command-center")).toBe(true);
  });
  it("each binding has mac + nonMac + section", () => {
    for (const b of DEFAULT_BINDINGS) {
      expect(b.mac).toBeTruthy();
      expect(b.nonMac).toBeTruthy();
      expect(b.section).toBeTruthy();
    }
  });
});
