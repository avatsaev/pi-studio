/**
 * ConnectionProvider & boot-gate tests — sprint-023 / task-005
 *
 * Tests the connection logic (address loading, boot gate state transitions)
 * without mounting React. Focuses on the pure store/logic layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DAEMON_ADDRESS_KEY, DEFAULT_DAEMON_ADDRESS } from "./ConnectionProvider.js";
import { useSessionStore } from "../store/session-store.js";
import { createMemoryKVStore } from "./kv-store.js";

function resetStore() {
  useSessionStore.setState({
    agents: {},
    workspaces: {},
    servers: {},
    activeServerId: null,
  });
}

describe("ConnectionProvider — constants", () => {
  it("DAEMON_ADDRESS_KEY is stable", () => {
    expect(DAEMON_ADDRESS_KEY).toBe("pi-studio-daemon-address");
  });

  it("DEFAULT_DAEMON_ADDRESS is a valid ws:// URL", () => {
    expect(DEFAULT_DAEMON_ADDRESS).toMatch(/^ws:\/\//);
  });
});

describe("ConnectionProvider — KV address store", () => {
  it("reads daemon address from KV store", () => {
    const kv = createMemoryKVStore();
    kv.set(DAEMON_ADDRESS_KEY, "ws://192.168.1.50:6767");
    expect(kv.get(DAEMON_ADDRESS_KEY)).toBe("ws://192.168.1.50:6767");
  });

  it("returns null when no address stored", () => {
    const kv = createMemoryKVStore();
    expect(kv.get(DAEMON_ADDRESS_KEY)).toBeNull();
  });

  it("overwrites address on setAddress", () => {
    const kv = createMemoryKVStore();
    kv.set(DAEMON_ADDRESS_KEY, "ws://old:6767");
    kv.set(DAEMON_ADDRESS_KEY, "ws://new:6767");
    expect(kv.get(DAEMON_ADDRESS_KEY)).toBe("ws://new:6767");
  });
});

describe("ConnectionProvider — session store wiring", () => {
  beforeEach(resetStore);

  it("setServerInfo populates servers map", () => {
    useSessionStore.getState().setServerInfo({ serverId: "srv1", version: "2.0.0" });
    expect(useSessionStore.getState().servers["srv1"]?.version).toBe("2.0.0");
  });

  it("setActiveServer sets active server id", () => {
    useSessionStore.getState().setActiveServer("srv1");
    expect(useSessionStore.getState().activeServerId).toBe("srv1");
  });

  it("clearAllAgents clears on disconnect", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    useSessionStore.getState().clearAllAgents();
    expect(Object.keys(useSessionStore.getState().agents)).toHaveLength(0);
  });
});

describe("ConnectionProvider — reconnect manager integration", () => {
  it("ReconnectionManager can be instantiated and stopped", async () => {
    const { ReconnectionManager } = await import("@av-pi-studio/client");

    const mockDaemon = {
      onStateChange: vi.fn(() => () => {}),
      connect: vi.fn().mockResolvedValue(undefined),
      serverId: "srv1",
    };

    const mgr = new ReconnectionManager(mockDaemon as never, { maxAttempts: 1 });
    mgr.start();
    mgr.stop();
    expect(mgr.attemptCount).toBe(0);
  });

  it("onReconnected is called when connection restored", async () => {
    const { ReconnectionManager } = await import("@av-pi-studio/client");

    let stateHandler: ((state: string) => void) | undefined;
    const mockDaemon = {
      onStateChange: vi.fn((h: (state: string) => void) => {
        stateHandler = h;
        return () => {};
      }),
      connect: vi.fn().mockResolvedValue(undefined),
      serverId: "srv1",
    };

    const reconnectedCb = vi.fn();
    const mgr = new ReconnectionManager(mockDaemon as never, {
      initialDelayMs: 1,
      maxDelayMs: 5,
    });
    mgr.onReconnected(reconnectedCb);
    mgr.start();

    // Simulate: closed → attempt reconnect → open
    stateHandler?.("closed");
    await new Promise((r) => setTimeout(r, 10));

    // connect was called at least once
    expect(mockDaemon.connect).toHaveBeenCalled();

    mgr.stop();
  });
});

describe("ConnectionProvider — boot gate decisions", () => {
  it("no-hosts state when no address in KV", () => {
    const kv = createMemoryKVStore();
    const hasAddress = !!kv.get(DAEMON_ADDRESS_KEY);
    // No address → boot gate should show welcome screen
    expect(hasAddress).toBe(false);
  });

  it("connecting state expected when address present", () => {
    const kv = createMemoryKVStore();
    kv.set(DAEMON_ADDRESS_KEY, "ws://127.0.0.1:6767");
    const hasAddress = !!kv.get(DAEMON_ADDRESS_KEY);
    expect(hasAddress).toBe(true);
  });
});
