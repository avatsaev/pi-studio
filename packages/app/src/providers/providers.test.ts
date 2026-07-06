/**
 * Tests for providers: KV store, connection reducer, UI reducer.
 */

import { describe, it, expect } from "vitest";
import { createMemoryKVStore } from "./kv-store.js";
import {
  connectionReducer,
  INITIAL_CONNECTION_STATE,
  type ConnectionAction,
} from "./connection-store.js";
import { uiReducer, INITIAL_UI_STATE, type UIAction } from "./ui-store.js";
import { type HostRuntimeSnapshot } from "../runtime/host-runtime.js";

describe("KeyValueStore (memory)", () => {
  it("round-trips get/set", () => {
    const store = createMemoryKVStore();
    expect(store.get("k")).toBeNull();
    store.set("k", "v");
    expect(store.get("k")).toBe("v");
  });

  it("remove deletes a key", () => {
    const store = createMemoryKVStore();
    store.set("a", "1");
    store.remove("a");
    expect(store.get("a")).toBeNull();
  });
});

describe("connectionReducer", () => {
  const mockSnapshot: HostRuntimeSnapshot = {
    profile: { id: "h1", serverId: "s1", label: "Test", kind: "direct" as const, url: "ws://localhost:6767", createdAtMs: 0 },
    status: "online",
    serverId: "s1",
    features: {},
    reconnectAttempt: 0,
    client: {
      serverInfo: { serverId: "s1", features: {} },
      onDrop: () => () => {},
    },
  };

  it("set_host adds a host snapshot", () => {
    const state = connectionReducer(INITIAL_CONNECTION_STATE, {
      type: "set_host",
      snapshot: mockSnapshot,
    });
    expect(state.hosts["s1"]).toBe(mockSnapshot);
  });

  it("remove_host removes and clears active if matching", () => {
    let state = connectionReducer(INITIAL_CONNECTION_STATE, {
      type: "set_host",
      snapshot: mockSnapshot,
    });
    state = connectionReducer(state, { type: "set_active", serverId: "s1" });
    state = connectionReducer(state, { type: "remove_host", serverId: "s1" });
    expect(state.hosts["s1"]).toBeUndefined();
    expect(state.activeServerId).toBeNull();
  });

  it("set_active creates session context for online host", () => {
    let state = connectionReducer(INITIAL_CONNECTION_STATE, {
      type: "set_host",
      snapshot: mockSnapshot,
    });
    state = connectionReducer(state, { type: "set_active", serverId: "s1" });
    expect(state.activeServerId).toBe("s1");
    expect(state.session).not.toBeNull();
    expect(state.session!.serverId).toBe("s1");
  });

  it("set_active with null clears session", () => {
    let state = connectionReducer(INITIAL_CONNECTION_STATE, {
      type: "set_host",
      snapshot: mockSnapshot,
    });
    state = connectionReducer(state, { type: "set_active", serverId: "s1" });
    state = connectionReducer(state, { type: "set_active", serverId: null });
    expect(state.session).toBeNull();
  });
});

describe("uiReducer", () => {
  it("toggle_sidebar flips sidebarOpen", () => {
    const s1 = uiReducer(INITIAL_UI_STATE, { type: "toggle_sidebar" });
    expect(s1.sidebarOpen).toBe(false);
    const s2 = uiReducer(s1, { type: "toggle_sidebar" });
    expect(s2.sidebarOpen).toBe(true);
  });

  it("set_sidebar sets explicit value", () => {
    const s = uiReducer(INITIAL_UI_STATE, { type: "set_sidebar", open: false });
    expect(s.sidebarOpen).toBe(false);
  });

  it("toggle_command_center flips commandCenterOpen", () => {
    const s = uiReducer(INITIAL_UI_STATE, { type: "toggle_command_center" });
    expect(s.commandCenterOpen).toBe(true);
  });

  it("set_command_center sets explicit value", () => {
    const s = uiReducer(INITIAL_UI_STATE, { type: "set_command_center", open: true });
    expect(s.commandCenterOpen).toBe(true);
  });
});
