import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseBrowserConnectIntent } from "./browser-launch.js";
import { installHost, resetHostForTests } from "./install.js";
import { type ConnectIntent } from "./types.js";
import { applyConnectIntent } from "../hooks/use-connection.js";
import { startAgentDeepLinkBoot } from "../hooks/use-agent-deep-link-boot.js";
import { applyPendingAgentDeepLink } from "../features/sessions/apply-agent-deep-link.js";
import { useConnectionStore } from "../lib/connection/connection-store.js";
import { useDeepLinkStore } from "../stores/deep-link-store.js";
import { useSessionStore } from "../stores/session-store.js";
import { resetLayoutStore, resetSessionStore, resetTabStore } from "../test/reset-stores.js";
import { createTestHost } from "../test/test-host.js";

function loc(search = "", hash = "") {
  return { href: `http://app.local/${search}${hash}`, search, hash };
}

function fields(initialHost = "ws://127.0.0.1:6767") {
  const state = { host: initialHost, password: "", cwd: "" };
  const connect = vi.fn();
  return {
    state,
    connect,
    deps: {
      setHost: (v: string) => void (state.host = v),
      setPassword: (v: string) => void (state.password = v),
      setCwd: (v: string) => void (state.cwd = v),
      fields: () => state,
      connect,
    },
  };
}

describe("browser launch URL grammar", () => {
  it("has no intent without launch parameters", () => {
    expect(parseBrowserConnectIntent(loc())).toBeNull();
    expect(parseBrowserConnectIntent(loc("", "#agent=a1"))).toBeNull();
  });

  it("pre-fills without connecting unless connect=1", () => {
    expect(parseBrowserConnectIntent(loc("?host=box:6767&password=pw&cwd=/w"))).toEqual({
      url: "box:6767",
      password: "pw",
      cwd: "/w",
      connect: false,
    });
    expect(parseBrowserConnectIntent(loc("?host=box:6767&connect=1"))).toEqual({
      url: "box:6767",
      connect: true,
    });
    expect(parseBrowserConnectIntent(loc("?connect=1"))).toEqual({ connect: true });
  });

  it("always connects a pairing link, from ?pair= or from the page's own #offer=", () => {
    expect(parseBrowserConnectIntent(loc("?pair=https%3A%2F%2Fx%2F%23offer%3Dabc"))).toEqual({
      url: "https://x/#offer=abc",
      connect: true,
    });
    const own = loc("", "#offer=abc");
    expect(parseBrowserConnectIntent(own)).toEqual({ url: own.href, connect: true });
  });
});

describe("applying a connect intent", () => {
  it("boots from the installed host's initial intent, read once", () => {
    resetHostForTests();
    const host = createTestHost({ connectIntent: { url: "box:6767", connect: true } });
    installHost(host);
    const f = fields();

    applyConnectIntent(host.launch.initialConnect(), f.deps);

    expect(f.connect).toHaveBeenCalledWith({ url: "box:6767", password: undefined });
    expect(host.calls.filter((c) => c.member === "launch.initialConnect")).toHaveLength(1);
  });

  it("does nothing for no intent", () => {
    const f = fields();
    applyConnectIntent(null, f.deps);
    expect(f.state.host).toBe("ws://127.0.0.1:6767");
    expect(f.connect).not.toHaveBeenCalled();
  });

  it("pre-fills only when connect is false", () => {
    const f = fields();
    applyConnectIntent({ url: "box:6767", password: "pw", cwd: "/w", connect: false }, f.deps);
    expect(f.state).toEqual({ host: "box:6767", password: "pw", cwd: "/w" });
    expect(f.connect).not.toHaveBeenCalled();
  });

  it("connects with the password for a plain address, and to the current host without a url", () => {
    const f = fields();
    applyConnectIntent({ url: "box:6767", password: "pw", connect: true }, f.deps);
    expect(f.connect).toHaveBeenCalledWith({ url: "box:6767", password: "pw" });

    const g = fields();
    applyConnectIntent({ connect: true }, g.deps);
    expect(g.connect).toHaveBeenCalledWith({ url: "ws://127.0.0.1:6767", password: undefined });
  });

  it("never sends a password with a pairing link", () => {
    const offer = encodeURIComponent(btoa(String.fromCharCode(...new Uint8Array(32).fill(1))));
    const pairing = `https://app.local/#offer=${offer}&host=box:6767`;
    const f = fields();
    const intent: ConnectIntent = { url: pairing, password: "pw", connect: true };
    applyConnectIntent(intent, f.deps);
    expect(f.connect).toHaveBeenCalledWith({ url: pairing, password: undefined });
  });
});

describe("agent deep link through the host", () => {
  beforeEach(() => {
    resetHostForTests();
    resetSessionStore();
    resetTabStore();
    resetLayoutStore();
    useDeepLinkStore.setState({ pendingAgentId: undefined, restored: false });
    useConnectionStore.setState({ status: "idle" });
  });

  it("stores the boot-time link and waits for restore", () => {
    const host = createTestHost({ agentDeepLink: "a1" });
    const apply = vi.fn();
    const stop = startAgentDeepLinkBoot(host.launch.agentDeepLink, apply);
    expect(useDeepLinkStore.getState().pendingAgentId).toBe("a1");
    expect(apply).not.toHaveBeenCalled();
    stop();
  });

  it("applies a link delivered through subscribe once connected and restored", () => {
    const host = createTestHost();
    const apply = vi.fn();
    const stop = startAgentDeepLinkBoot(host.launch.agentDeepLink, apply);
    useConnectionStore.setState({ status: "open" });
    useDeepLinkStore.getState().markRestored();

    host.emitAgentDeepLink("a2");

    expect(useDeepLinkStore.getState().pendingAgentId).toBe("a2");
    expect(apply).toHaveBeenCalledTimes(1);
    stop();
    host.emitAgentDeepLink("a3");
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("consumes the source after applying and after rejecting a target", () => {
    const host = createTestHost();
    installHost(host);
    const id = useSessionStore.getState().createSession("/work");
    useSessionStore.getState().bindAgent(id, "known");

    useDeepLinkStore.getState().set("known");
    applyPendingAgentDeepLink();
    expect(useSessionStore.getState().activeSessionId).toBe(id);

    useDeepLinkStore.getState().set("missing");
    applyPendingAgentDeepLink();

    expect(host.calls.filter((c) => c.member === "launch.agentDeepLink.consume")).toHaveLength(2);
  });
});
