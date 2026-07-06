/**
 * Tests for the router layer: route path building + parsing round-trips,
 * and boot resolver → initial route decisions.
 */

import { describe, it, expect } from "vitest";
import { routes, parseRoute, type ParsedRoute } from "../runtime/route-grammar.js";
import { resolveBootRoute, type BootResolverInput } from "../runtime/boot-resolver.js";
import { type HostRuntimeSnapshot } from "../runtime/host-runtime.js";

function makeHost(serverId: string, status: "online" | "offline" = "online"): HostRuntimeSnapshot {
  return {
    profile: { id: serverId, serverId, label: serverId, kind: "direct", url: "ws://x", createdAtMs: 1 },
    status,
    serverId,
    features: {},
    reconnectAttempt: 0,
    client: status === "online"
      ? { serverInfo: { serverId, features: {} }, onDrop: () => () => {} }
      : undefined,
  };
}

describe("route grammar paths", () => {
  it("builds and parses /welcome", () => {
    const path = routes.welcome();
    expect(path).toBe("/welcome");
    expect(parseRoute(path)).toEqual({ kind: "welcome" });
  });

  it("builds and parses /h/:serverId", () => {
    const path = routes.hostRoot("abc");
    expect(path).toBe("/h/abc");
    expect(parseRoute(path)).toEqual({ kind: "host-root", serverId: "abc" });
  });

  it("builds and parses workspace route with open intent", () => {
    const path = routes.workspace("s1", "w1", { kind: "agent", id: "a1" });
    expect(path).toContain("/h/s1/workspace/w1");
    expect(path).toContain("open=");
    const parsed = parseRoute(path);
    expect(parsed.kind).toBe("workspace");
    if (parsed.kind === "workspace") {
      expect(parsed.serverId).toBe("s1");
      expect(parsed.workspaceId).toBe("w1");
      expect(parsed.open).toEqual({ kind: "agent", id: "a1" });
    }
  });

  it("builds and parses settings sections", () => {
    expect(parseRoute(routes.settingsSection("appearance"))).toEqual({
      kind: "settings",
      section: "appearance",
    });
  });

  it("builds and parses /sessions", () => {
    expect(parseRoute(routes.sessions())).toEqual({ kind: "sessions" });
  });

  it("builds and parses /schedules", () => {
    expect(parseRoute(routes.schedules())).toEqual({ kind: "schedules" });
  });

  it("builds and parses host-settings section", () => {
    const path = routes.hostSettingsSection("s1", "providers");
    const parsed = parseRoute(path);
    expect(parsed).toEqual({ kind: "host-settings", serverId: "s1", section: "providers" });
  });

  it("unknown routes parse as unknown", () => {
    expect(parseRoute("/foo/bar")).toEqual({ kind: "unknown" });
  });
});

describe("boot resolver → initial route", () => {
  it("no hosts + gaveUp → /welcome", () => {
    const result = resolveBootRoute({ storeReady: true, gaveUp: true, hosts: [] });
    expect(result).toEqual({ kind: "redirect", to: "/welcome" });
  });

  it("online host → host root", () => {
    const result = resolveBootRoute({
      storeReady: true,
      gaveUp: false,
      hosts: [makeHost("s1")],
    });
    expect(result).toEqual({ kind: "redirect", to: "/h/s1" });
  });

  it("saved workspace + online host → workspace route", () => {
    const result = resolveBootRoute({
      storeReady: true,
      gaveUp: false,
      hosts: [makeHost("s1")],
      lastWorkspace: { serverId: "s1", workspaceId: "w1" },
    });
    expect(result.kind).toBe("redirect");
    if (result.kind === "redirect") {
      expect(result.to).toContain("/h/s1/workspace/w1");
    }
  });

  it("saved workspace but host offline → earliest online host", () => {
    const offlineHost = makeHost("s1", "offline");
    const onlineHost = makeHost("s2");
    const result = resolveBootRoute({
      storeReady: true,
      gaveUp: false,
      hosts: [offlineHost, onlineHost],
      lastWorkspace: { serverId: "s1", workspaceId: "w1" },
    });
    expect(result).toEqual({ kind: "redirect", to: "/h/s2" });
  });

  it("no hosts, not gaveUp → splash", () => {
    const result = resolveBootRoute({ storeReady: true, gaveUp: false, hosts: [] });
    expect(result).toEqual({ kind: "splash" });
  });

  it("splashError → splash-error", () => {
    const result = resolveBootRoute({
      storeReady: true,
      gaveUp: false,
      hosts: [],
      splashError: { message: "daemon crashed" },
    });
    expect(result).toEqual({ kind: "splash-error", message: "daemon crashed", logPath: undefined });
  });
});
