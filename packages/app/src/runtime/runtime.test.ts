import { describe, expect, it } from "vitest";

import type { ConnectedDaemonClient, HostConnector, Scheduler } from "./host-runtime.js";
import { HostRuntimeController } from "./host-runtime.js";
import type { HostProfile } from "./host-profile.js";
import {
  buildOpenIntent,
  decodeWorkspaceId,
  encodeWorkspaceId,
  normalizeAppSettingsSection,
  normalizeHostSettingsSection,
  parseOpenIntent,
  parseRoute,
  routes,
} from "./route-grammar.js";
import { guardHostRoute, resolveBootRoute, StoreReadyLatch } from "./boot-resolver.js";
import { createSessionContextValue } from "./session-context.js";
import {
  activeHostForPath,
  ALWAYS_MOUNTED_OVERLAY_SINGLETONS,
  ROOT_PROVIDER_STACK,
  shouldShowSidebar,
  translateRouteToHost,
} from "./app-shell.js";

function profile(id: string, createdAtMs: number, serverId?: string): HostProfile {
  return { id, kind: "direct", label: id, url: `ws://localhost/${id}`, createdAtMs, serverId };
}

class DropClient implements ConnectedDaemonClient {
  private cb: ((error?: Error) => void) | null = null;
  constructor(public readonly serverInfo: { serverId: string; features: Record<string, boolean> }) {}
  onDrop(callback: (error?: Error) => void): () => void {
    this.cb = callback;
    return () => { this.cb = null; };
  }
  drop(error?: Error): void {
    this.cb?.(error);
  }
}

class ManualScheduler implements Scheduler {
  readonly tasks: Array<{ delay: number; cb: () => void }> = [];
  setTimeout(callback: () => void, delayMs: number): unknown {
    this.tasks.push({ delay: delayMs, cb: callback });
    return this.tasks.length;
  }
  runNext(): void {
    const task = this.tasks.shift();
    if (task) task.cb();
  }
}

describe("HostRuntimeController", () => {
  it("connects a saved host, records serverId/features, and exposes online state", async () => {
    const client = new DropClient({ serverId: "srv-1", features: { schedules: true } });
    const connector: HostConnector = { connect: async () => client };
    const controller = new HostRuntimeController([profile("p1", 1)], { connector, now: () => 100 });

    await controller.connectHost("p1");

    const snap = controller.get("srv-1");
    expect(snap?.status).toBe("online");
    expect(snap?.serverId).toBe("srv-1");
    expect(snap?.features.schedules).toBe(true);
    expect(snap?.lastOnlineAtMs).toBe(100);
    expect(controller.getStoreReady()).toBe(true);
  });

  it("on drop marks offline, schedules backoff reconnect, and rehydrates features", async () => {
    const first = new DropClient({ serverId: "srv-1", features: { schedules: false } });
    const second = new DropClient({ serverId: "srv-1", features: { schedules: true, providerUsageList: true } });
    let calls = 0;
    const connector: HostConnector = { connect: async () => (++calls === 1 ? first : second) };
    const scheduler = new ManualScheduler();
    const controller = new HostRuntimeController([profile("p1", 1)], {
      connector,
      scheduler,
      now: () => 500,
      backoffMs: (attempt) => attempt * 100,
    });

    await controller.connectHost("p1");
    first.drop(new Error("socket closed"));

    const offline = controller.get("srv-1");
    expect(offline?.status).toBe("offline");
    expect(offline?.reconnectAttempt).toBe(1);
    expect(scheduler.tasks[0]?.delay).toBe(100);

    scheduler.runNext();
    await Promise.resolve();
    await Promise.resolve();

    const online = controller.get("srv-1");
    expect(online?.status).toBe("online");
    expect(online?.features.providerUsageList).toBe(true);
    expect(online?.reconnectAttempt).toBe(0);
  });

  it("earliestOnlineHost chooses creation order", async () => {
    const connector: HostConnector = {
      connect: async (p) => new DropClient({ serverId: `${p.id}-server`, features: {} }),
    };
    const controller = new HostRuntimeController([profile("later", 20), profile("earlier", 10)], { connector });
    await controller.connectAll();
    expect(controller.earliestOnlineHost()?.profile.id).toBe("earlier");
  });
});

describe("route grammar", () => {
  it("builds documented core paths", () => {
    expect(routes.root()).toBe("/");
    expect(routes.welcome()).toBe("/welcome");
    expect(routes.sessions()).toBe("/sessions");
    expect(routes.hostOpenProject("srv 1")).toBe("/h/srv%201/open-project");
  });

  it("workspace id safe values are URL encoded normally", () => {
    expect(encodeWorkspaceId("abc-123._~")).toBe("abc-123._~");
    expect(decodeWorkspaceId("abc-123._~")).toBe("abc-123._~");
  });

  it("workspace id unsafe values are base64url encoded with b64_ prefix", () => {
    const encoded = encodeWorkspaceId("project/worktree 🧪");
    expect(encoded.startsWith("b64_")).toBe(true);
    expect(decodeWorkspaceId(encoded)).toBe("project/worktree 🧪");
  });

  it("open intent builds/parses agent and file intents", () => {
    const agent = buildOpenIntent({ kind: "agent", id: "a1" });
    expect(agent).toBe("agent:a1");
    expect(parseOpenIntent(agent)).toEqual({ kind: "agent", id: "a1" });

    const file = buildOpenIntent({ kind: "file", path: "/tmp/a b.txt" });
    expect(parseOpenIntent(file)).toEqual({ kind: "file", path: "/tmp/a b.txt" });
  });

  it("parses every important documented route kind", () => {
    expect(parseRoute("/").kind).toBe("root");
    expect(parseRoute("/welcome").kind).toBe("welcome");
    expect(parseRoute("/open-project")).toEqual({ kind: "open-project" });
    expect(parseRoute("/h/srv/open-project")).toEqual({ kind: "open-project", serverId: "srv" });
    expect(parseRoute("/h/srv/sessions")).toEqual({ kind: "sessions", legacyServerId: "srv" });
    expect(parseRoute("/h/srv/agent/a1")).toEqual({ kind: "agent", serverId: "srv", agentId: "a1" });
    expect(parseRoute("/settings/projects/proj%201")).toEqual({ kind: "projects", projectKey: "proj 1" });
  });

  it("parses workspace route with open intent", () => {
    const path = routes.workspace("srv", "project/worktree 🧪", { kind: "agent", id: "a1" });
    expect(parseRoute(path)).toEqual({
      kind: "workspace",
      serverId: "srv",
      workspaceId: "project/worktree 🧪",
      open: { kind: "agent", id: "a1" },
    });
  });

  it("normalizes app and host settings slugs", () => {
    expect(normalizeAppSettingsSection("shortcuts", true)).toBe("shortcuts");
    expect(normalizeAppSettingsSection("shortcuts", false)).toBe("general");
    expect(normalizeAppSettingsSection("bad", true)).toBe("general");
    expect(normalizeHostSettingsSection("orchestration")).toBe("agents");
    expect(normalizeHostSettingsSection("daemon")).toBe("host");
    expect(normalizeHostSettingsSection("bad")).toBe("connections");
  });
});

describe("boot resolver and host guard", () => {
  const onlineHost = {
    profile: profile("p1", 1, "srv-1"),
    status: "online" as const,
    serverId: "srv-1",
    features: {},
    reconnectAttempt: 0,
  };

  it("shows splash before give-up with no online hosts", () => {
    expect(resolveBootRoute({ storeReady: false, gaveUp: false, hosts: [] })).toEqual({ kind: "splash" });
  });

  it("redirects to remembered workspace when that host is online", () => {
    expect(resolveBootRoute({
      storeReady: true,
      gaveUp: false,
      hosts: [onlineHost],
      lastWorkspace: { serverId: "srv-1", workspaceId: "w1" },
    })).toEqual({ kind: "redirect", to: "/h/srv-1/workspace/w1" });
  });

  it("redirects to earliest online host root when no remembered workspace", () => {
    expect(resolveBootRoute({ storeReady: true, gaveUp: false, hosts: [onlineHost] })).toEqual({
      kind: "redirect",
      to: "/h/srv-1",
    });
  });

  it("redirects to welcome after give-up", () => {
    expect(resolveBootRoute({ storeReady: true, gaveUp: true, hosts: [] })).toEqual({ kind: "redirect", to: "/welcome" });
  });

  it("returns splash-error for desktop daemon start errors", () => {
    expect(resolveBootRoute({ storeReady: true, gaveUp: false, hosts: [], splashError: { message: "boom", logPath: "/tmp/log" } })).toEqual({
      kind: "splash-error",
      message: "boom",
      logPath: "/tmp/log",
    });
  });

  it("h/* guard shows splash until store ready", () => {
    expect(guardHostRoute({ storeReady: false, serverId: "srv-1", hosts: [onlineHost] })).toEqual({ kind: "splash" });
  });

  it("h/* guard allows known host", () => {
    expect(guardHostRoute({ storeReady: true, serverId: "srv-1", hosts: [onlineHost] })).toEqual({ kind: "allow" });
  });

  it("h/* guard redirects unknown host to first host or welcome", () => {
    expect(guardHostRoute({ storeReady: true, serverId: "missing", hosts: [onlineHost] })).toEqual({
      kind: "redirect",
      to: "/h/srv-1/open-project",
    });
    expect(guardHostRoute({ storeReady: true, serverId: "missing", hosts: [] })).toEqual({ kind: "redirect", to: "/welcome" });
  });

  it("store-ready flag latches", () => {
    const latch = new StoreReadyLatch();
    expect(latch.value).toBe(false);
    expect(latch.update({ onlineHost: true, splashError: false, gaveUp: false })).toBe(true);
    expect(latch.update({ onlineHost: false, splashError: false, gaveUp: false })).toBe(true);
  });
});

describe("session context and app shell", () => {
  const host = {
    profile: profile("p1", 1, "srv-1"),
    status: "online" as const,
    serverId: "srv-1",
    client: new DropClient({ serverId: "srv-1", features: {} }),
    features: {},
    reconnectAttempt: 0,
  };

  it("creates session context only for online hosts with client", () => {
    const ctx = createSessionContextValue(host);
    expect(ctx?.serverId).toBe("srv-1");
    expect(createSessionContextValue({ ...host, status: "offline", client: undefined })).toBe(null);
  });

  it("provider stack order has portal inside app context but before runtime singletons", () => {
    expect(ROOT_PROVIDER_STACK[0]).toBe("gesture-root");
    expect(ROOT_PROVIDER_STACK).toContain("portal-provider");
    expect(ROOT_PROVIDER_STACK.at(-1)).toBe("app-shell");
  });

  it("sidebar appears only when store-ready and path has a known host", () => {
    expect(shouldShowSidebar("/h/srv-1/workspace/w1", false, [host])).toBe(false);
    expect(shouldShowSidebar("/welcome", true, [host])).toBe(false);
    expect(shouldShowSidebar("/h/srv-1/workspace/w1", true, [host])).toBe(true);
    expect(shouldShowSidebar("/h/missing/workspace/w1", true, [host])).toBe(false);
  });

  it("activeHostForPath resolves path host else earliest host", () => {
    const earlier = { ...host, profile: profile("p0", 0, "srv-0"), serverId: "srv-0" };
    expect(activeHostForPath("/h/srv-1/open-project", [earlier, host])?.serverId).toBe("srv-1");
    expect(activeHostForPath("/sessions", [host, earlier])?.serverId).toBe("srv-0");
  });

  it("host switching preserves equivalent route", () => {
    expect(translateRouteToHost("/sessions", "srv-2")).toBe("/sessions");
    expect(translateRouteToHost("/h/srv-1/open-project", "srv-2")).toBe("/h/srv-2/open-project");
    expect(translateRouteToHost("/h/srv-1/agent/a1", "srv-2")).toBe("/h/srv-2/agent/a1");
  });

  it("always-mounted overlay singleton catalog includes command palette and quitting overlay", () => {
    expect(ALWAYS_MOUNTED_OVERLAY_SINGLETONS).toContain("command-palette");
    expect(ALWAYS_MOUNTED_OVERLAY_SINGLETONS).toContain("quitting-overlay");
  });
});
