import { setImmediate } from "node:timers/promises";

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { silentLogger, type Logger } from "../logging/logger.js";
import { createInMemoryCapabilityStore } from "../ws/capability-store.js";
import { MAX_SEND_QUEUE_BYTES } from "../ws/limits.js";
import { HandlerRegistry, routeBinaryFrame, routeTextFrame } from "../ws/router.js";
import type { Session } from "../ws/session.js";
import type { RelayConnection } from "./relay-connection.js";
import { attachRelaySession } from "./relay-sessions.js";

/** A scripted `RelayConnection`: tests push records in and read what the daemon sent. */
interface FakeConn extends RelayConnection {
  bufferedAmount: number;
  isOpen: boolean;
  texts: string[];
  binaries: Uint8Array[];
  close: Mock<(code?: number, reason?: string) => void>;
  terminate: Mock<() => void>;
  emitText(text: string): void;
  emitBinary(bytes: Uint8Array): void;
  emitClose(code: number): void;
  emitReady(): void;
}

function noop(): void {}

function fakeConn(connectionId: string): FakeConn {
  let onReady = noop;
  let onText = noop;
  let onBinary = noop;
  let onClose = noop;
  const conn: FakeConn = {
    connectionId,
    bufferedAmount: 0,
    isOpen: true,
    texts: [],
    binaries: [],
    sendText: (t) => void conn.texts.push(t),
    sendBinary: (b) => void conn.binaries.push(b),
    close: vi.fn(),
    pause: vi.fn(),
    terminate: vi.fn(),
    resume: vi.fn(),
    onReady: (h) => void (onReady = h),
    onText: (h) => void (onText = h as typeof noop),
    onBinary: (h) => void (onBinary = h as typeof noop),
    onClose: (h) => void (onClose = h as typeof noop),
    emitText: (t) => (onText as (t: string) => void)(t),
    emitBinary: (b) => (onBinary as (b: Uint8Array) => void)(b),
    emitClose: (code) => (onClose as (code: number, reason: string) => void)(code, ""),
    emitReady: () => onReady(),
  };
  return conn;
}

const hello = (clientId: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: "hello", clientId, clientType: "browser", protocolVersion: 1, ...extra });

function setup(helloTimeoutMs?: number, logger: Logger = silentLogger()) {
  const registry = new HandlerRegistry();
  registry.register("echo", ({ message }) => ({ type: "echoed", value: message.value }));
  const capabilityStore = createInMemoryCapabilityStore();
  const opened: Session[] = [];
  const closed: Session[] = [];
  const binary: Array<{ session: Session; bytes: Uint8Array }> = [];
  const attach = (conn: RelayConnection): void =>
    attachRelaySession(conn, {
      registry,
      routeTextFrame,
      routeBinaryFrame,
      binaryHandler: (session, bytes) => void binary.push({ session, bytes }),
      capabilityStore,
      buildServerInfo: () => ({
        status: "server_info",
        serverId: "srv",
        hostname: "h",
        version: "1.0.0",
        homeDir: "/home/x",
        capabilities: {},
        features: {},
      }),
      onSessionOpen: (s) => void opened.push(s),
      onSessionClose: (s) => void closed.push(s),
      logger,
      helloTimeoutMs,
    });
  return { attach, registry, opened, closed, binary, capabilityStore };
}

describe("attachRelaySession", () => {
  it("creates a relay session on hello, answers server_info, then routes RPCs", async () => {
    const { attach, opened } = setup();
    const conn = fakeConn("c1");
    attach(conn);

    conn.emitText(
      hello("client-a", { platform: "desktop", appVersion: "9.9", agentStreams: "none" }),
    );
    expect(opened).toHaveLength(1);
    const session = opened[0]!;
    expect(session.transport).toBe("relay");
    expect(session.clientId).toBe("client-a");
    expect(session.platform).toBe("desktop");
    expect(session.appVersion).toBe("9.9");
    expect(session.agentStreams).toBe("none");

    const status = JSON.parse(conn.texts[0]!);
    expect(status.type).toBe("status");
    expect(status.payload).toMatchObject({
      status: "server_info",
      serverId: "srv",
      homeDir: "/home/x",
    });

    conn.emitText(
      JSON.stringify({ type: "session", message: { type: "echo", requestId: "r1", value: 7 } }),
    );
    await vi.waitFor(() => expect(conn.texts).toHaveLength(2));
    expect(JSON.stringify(JSON.parse(conn.texts[1]!))).toContain('"requestId":"r1"');
    expect(opened).toHaveLength(1);
  });

  it.each([
    ["non-JSON", "not json", "invalid hello"],
    ["valid JSON but not hello", JSON.stringify({ type: "ping" }), "first frame must be hello"],
  ])("closes with 1008 on an invalid first record (%s) and creates no session", (_n, text, why) => {
    const { attach, opened, closed } = setup();
    const conn = fakeConn("c1");
    attach(conn);
    conn.emitText(text);
    expect(conn.close).toHaveBeenCalledWith(1008, why);
    expect(opened).toHaveLength(0);
    expect(conn.texts).toHaveLength(0);
    conn.emitClose(1008);
    expect(closed).toHaveLength(0);
  });

  it("exposes the connection through the session socket facade", () => {
    const { attach, opened, binary } = setup();
    const conn = fakeConn("c1");
    attach(conn);
    conn.emitText(hello("a"));
    const session = opened[0]!;

    conn.bufferedAmount = 1234;
    expect(session.bufferedAmount).toBe(1234);
    expect(session.isOpen).toBe(true);
    conn.isOpen = false;
    expect(session.isOpen).toBe(false);

    session.close(4000, "x");
    expect(conn.close).toHaveBeenCalledWith(4000, "x");

    const bytes = new Uint8Array([1, 2, 3]);
    session.sendBinary(bytes);
    expect(conn.binaries).toEqual([bytes]);

    // Binary records after hello reach the shared binary handler; before hello they are dropped.
    conn.emitBinary(bytes);
    expect(binary).toEqual([{ session, bytes }]);
  });

  it("closes with 1013 and terminates a relay session whose send queue passed the cap, and logs the client", () => {
    const warn = vi.fn();
    const { attach, opened } = setup(undefined, { ...silentLogger(), warn });
    const conn = fakeConn("c1");
    attach(conn);
    conn.emitText(hello("client-slow"));
    const sentBefore = conn.texts.length;
    conn.bufferedAmount = MAX_SEND_QUEUE_BYTES + 1;

    opened[0]!.send({ type: "session", message: {} });
    opened[0]!.sendBinary(new Uint8Array([1]));

    expect(conn.close).toHaveBeenCalledTimes(1);
    expect(conn.close).toHaveBeenCalledWith(1013, "send queue full");
    expect(conn.terminate).toHaveBeenCalledTimes(1);
    expect(conn.texts).toHaveLength(sentBefore);
    expect(conn.binaries).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ clientId: "client-slow", via: "relay" });
  });

  it("pauses and resumes the data socket through the session", () => {
    const { attach, opened } = setup();
    const conn = fakeConn("c1");
    attach(conn);
    conn.emitText(hello("a"));
    opened[0]!.pauseReading();
    expect(conn.pause).toHaveBeenCalledTimes(1);
    opened[0]!.resumeReading();
    expect(conn.resume).toHaveBeenCalledTimes(1);
  });

  it("drops binary records that arrive before hello", () => {
    const { attach, binary } = setup();
    const conn = fakeConn("c1");
    attach(conn);
    conn.emitBinary(new Uint8Array([9]));
    expect(binary).toHaveLength(0);
    expect(conn.close).not.toHaveBeenCalled();
  });

  it("gives two connections independent sessions and disposes only the closed one", () => {
    const { attach, opened, closed } = setup();
    const a = fakeConn("a");
    const b = fakeConn("b");
    attach(a);
    attach(b);
    a.emitText(hello("client-a"));
    b.emitText(hello("client-b"));
    expect(opened).toHaveLength(2);
    expect(opened[0]).not.toBe(opened[1]);
    expect(opened[0]!.id).not.toBe(opened[1]!.id);

    a.emitClose(1000);
    expect(closed).toEqual([opened[0]]);
    expect(b.close).not.toHaveBeenCalled();
    b.emitClose(1000);
    expect(closed).toEqual([opened[0], opened[1]]);
  });

  it("keeps closing when onSessionClose throws", () => {
    const store = createInMemoryCapabilityStore();
    const conn = fakeConn("c1");
    attachRelaySession(conn, {
      registry: new HandlerRegistry(),
      routeTextFrame,
      routeBinaryFrame,
      binaryHandler: () => {},
      capabilityStore: store,
      buildServerInfo: () => ({
        status: "server_info",
        serverId: "s",
        capabilities: {},
        features: {},
      }),
      onSessionOpen: () => {},
      onSessionClose: () => {
        throw new Error("boom");
      },
      logger: silentLogger(),
    });
    conn.emitText(hello("a"));
    expect(() => conn.emitClose(1000)).not.toThrow();
  });

  it("reuses stored capabilities when a later hello omits them, and persists new ones", () => {
    const { attach, opened, capabilityStore } = setup();
    const first = fakeConn("c1");
    attach(first);
    first.emitText(hello("client-a", { capabilities: { fileTransfer: true } }));
    expect(opened[0]!.capabilities).toEqual({ fileTransfer: true });
    expect(capabilityStore.get("client-a")).toEqual({ fileTransfer: true });

    const second = fakeConn("c2");
    attach(second);
    second.emitText(hello("client-a"));
    expect(opened[1]!.capabilities).toEqual({ fileTransfer: true });

    const third = fakeConn("c3");
    attach(third);
    third.emitText(hello("client-a", { capabilities: { other: true } }));
    expect(opened[2]!.capabilities).toEqual({ other: true });
    expect(capabilityStore.get("client-a")).toEqual({ other: true });
  });
});

const slowRequest = (id: string): string =>
  JSON.stringify({ type: "session", message: { type: "slow", requestId: id } });

describe("attachRelaySession limits", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes a connection that has not sent hello within the limit after its key exchange", () => {
    vi.useFakeTimers();
    const { attach, opened, closed } = setup(5_000);
    const conn = fakeConn("c1");
    attach(conn);

    // Dialling and pairing are not counted: nothing runs before the key exchange is done.
    vi.advanceTimersByTime(60_000);
    expect(conn.close).not.toHaveBeenCalled();

    conn.emitReady();
    vi.advanceTimersByTime(4_999);
    expect(conn.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(conn.close).toHaveBeenCalledWith(1008, "hello timeout");
    expect(opened).toHaveLength(0);
    conn.emitClose(1008);
    expect(closed).toHaveLength(0);
  });

  it("does not close a connection that sent hello in time", () => {
    vi.useFakeTimers();
    const { attach, opened } = setup(5_000);
    const conn = fakeConn("c1");
    attach(conn);
    conn.emitReady();
    vi.advanceTimersByTime(4_000);
    conn.emitText(hello("a"));
    vi.advanceTimersByTime(60_000);
    expect(opened).toHaveLength(1);
    expect(conn.close).not.toHaveBeenCalled();
  });

  it("refuses the 65th request in flight on one connection and lets the first 64 finish", async () => {
    const { attach, registry } = setup();
    const release: Array<() => void> = [];
    registry.register("slow", () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      release.push(resolve);
      return promise;
    });
    const conn = fakeConn("c1");
    attach(conn);
    conn.emitText(hello("a"));
    for (let i = 0; i < 65; i++) conn.emitText(slowRequest(`r${i}`));

    await vi.waitFor(() => expect(conn.texts).toHaveLength(2));
    expect(JSON.parse(conn.texts[1]!)).toMatchObject({
      type: "session",
      message: { type: "rpc_error", requestId: "r64", code: "too_many_requests" },
    });
    expect(release).toHaveLength(64);
    for (const resolve of release) resolve();
    // A freed slot accepts a new request once the finished handlers have settled.
    await setImmediate();
    conn.emitText(slowRequest("again"));
    expect(release).toHaveLength(65);
    expect(conn.texts).toHaveLength(2);
  });
});
