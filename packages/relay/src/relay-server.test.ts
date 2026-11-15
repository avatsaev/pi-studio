import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { RELAY_CLOSE } from "./control.js";
import {
  startRelayServer,
  type RelayLimits,
  type RelayLogger,
  type RelayServerHandle,
} from "./relay-server.js";

/**
 * Integration tests for the relay protocol 2 server (architecture/relay-protocol.md § 1–3,
 * § Behavior — Relay): real `ws` sockets against the real server, with short injected timers.
 */

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "protocol",
  "fixtures",
  "external-clients",
  "relay",
);
const fixtureText = (name: string): string =>
  (JSON.parse(readFileSync(join(FIXTURE_DIR, `control.${name}.json`), "utf8")) as { text: string })
    .text;
const FIXTURE_CONNECTION_ID = (
  JSON.parse(readFileSync(join(FIXTURE_DIR, "keys.json"), "utf8")) as { connectionId: string }
).connectionId;

const SESSION = "a".repeat(32);
const OTHER_SESSION = "b".repeat(32);

let handle: RelayServerHandle | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await handle?.close();
  handle = undefined;
});

async function start(
  limits?: Partial<RelayLimits>,
  logger?: RelayLogger,
): Promise<RelayServerHandle> {
  handle = await startRelayServer({ host: "127.0.0.1", port: 0, limits, logger });
  return handle;
}

interface Probe {
  ws: WebSocket;
  /** Every message received, in order (text as string, binary as Buffer). */
  messages: Array<string | Buffer>;
  closed: Promise<{ code: number; reason: string }>;
  /** Resolves with the next message beyond the ones already consumed. */
  next(): Promise<string | Buffer>;
}

async function open(options?: { autoPong?: boolean }): Promise<Probe> {
  const ws = new WebSocket(`ws://127.0.0.1:${handle!.port}`, options);
  sockets.push(ws);
  const messages: Array<string | Buffer> = [];
  let consumed = 0;
  const waiters: Array<() => void> = [];
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    messages.push(isBinary ? data : data.toString("utf8"));
    for (const w of waiters.splice(0)) w();
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on("close", (code, reason: Buffer) => resolve({ code, reason: reason.toString("utf8") }));
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return {
    ws,
    messages,
    closed,
    next: async () => {
      while (messages.length <= consumed)
        await new Promise<void>((resolve) => waiters.push(resolve));
      return messages[consumed++]!;
    },
  };
}

const json = (v: unknown): string => JSON.stringify(v);

async function registerDaemon(sessionId = SESSION): Promise<Probe> {
  const control = await open();
  control.ws.send(json({ type: "relay_daemon_register", v: 2, sessionId }));
  expect(JSON.parse((await control.next()) as string)).toEqual({ type: "relay_registered" });
  return control;
}

/** Connect a client and return it with the connection id the daemon was dialed for. */
async function connectClient(
  control: Probe,
  sessionId = SESSION,
): Promise<{ client: Probe; connectionId: string }> {
  const client = await open();
  client.ws.send(json({ type: "relay_client_connect", v: 2, sessionId }));
  const dial = JSON.parse((await control.next()) as string) as {
    type: string;
    connectionId: string;
  };
  expect(dial.type).toBe("relay_dial");
  expect(dial.connectionId).toMatch(/^[0-9a-f]{32}$/);
  return { client, connectionId: dial.connectionId };
}

async function attach(connectionId: string, sessionId = SESSION): Promise<Probe> {
  const data = await open();
  data.ws.send(json({ type: "relay_daemon_attach", v: 2, sessionId, connectionId }));
  return data;
}

/** A full pair: control already registered; returns the client and its data socket, both paired. */
async function pair(
  control: Probe,
  sessionId = SESSION,
): Promise<{ client: Probe; data: Probe; connectionId: string }> {
  const { client, connectionId } = await connectClient(control, sessionId);
  const data = await attach(connectionId, sessionId);
  const expected = { type: "relay_paired", connectionId };
  expect(JSON.parse((await client.next()) as string)).toEqual(expected);
  expect(JSON.parse((await data.next()) as string)).toEqual(expected);
  return { client, data, connectionId };
}

const settle = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function expectClose(
  actual: { code: number; reason: string },
  spec: { code: number; reason: string },
): void {
  expect(actual).toEqual({ code: spec.code, reason: spec.reason });
}

describe("http", () => {
  it("binds the requested host:port and answers GET /health with 200 ok", async () => {
    await start();
    expect(handle!.port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${handle!.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("404s any other HTTP path", async () => {
    await start();
    const res = await fetch(`http://127.0.0.1:${handle!.port}/not-a-real-path`);
    expect(res.status).toBe(404);
  });
});

describe("pairing", () => {
  it("answers register with relay_registered, dials the control socket, and pairs both sides with the same id", async () => {
    await start();
    const control = await registerDaemon();
    expect(handle!.counts()).toMatchObject({ controls: 1, waiting: 0, pairs: 0 });
    const { client, connectionId } = await connectClient(control);
    expect(handle!.counts()).toMatchObject({ waiting: 1, pairs: 0 });
    const data = await attach(connectionId);
    const expected = { type: "relay_paired", connectionId };
    expect(JSON.parse((await client.next()) as string)).toEqual(expected);
    expect(JSON.parse((await data.next()) as string)).toEqual(expected);
    expect(handle!.counts()).toMatchObject({ waiting: 0, pairs: 1 });
  });

  it("sends control frames whose text equals the committed fixtures (connection id masked)", async () => {
    await start();
    const control = await open();
    control.ws.send(json({ type: "relay_daemon_register", v: 2, sessionId: SESSION }));
    expect(await control.next()).toBe(fixtureText("relay_registered"));
    const client = await open();
    client.ws.send(json({ type: "relay_client_connect", v: 2, sessionId: SESSION }));
    const dial = (await control.next()) as string;
    const connectionId = (JSON.parse(dial) as { connectionId: string }).connectionId;
    expect(dial.replace(connectionId, FIXTURE_CONNECTION_ID)).toBe(fixtureText("relay_dial"));
    const data = await attach(connectionId);
    const paired = fixtureText("relay_paired");
    expect(((await client.next()) as string).replace(connectionId, FIXTURE_CONNECTION_ID)).toBe(
      paired,
    );
    expect(((await data.next()) as string).replace(connectionId, FIXTURE_CONNECTION_ID)).toBe(
      paired,
    );
  });

  it("pairs two clients of one daemon with distinct data sockets and keeps their traffic apart", async () => {
    await start();
    const control = await registerDaemon();
    const a = await pair(control);
    const b = await pair(control);
    expect(a.connectionId).not.toBe(b.connectionId);

    const bin = Buffer.from([0, 1, 2, 255]);
    a.client.ws.send("a-text-1");
    a.client.ws.send(bin);
    a.client.ws.send("a-text-2");
    b.client.ws.send("b-text");
    a.data.ws.send("to-a");
    a.data.ws.send(bin);
    b.data.ws.send("to-b");

    expect(await a.data.next()).toBe("a-text-1");
    expect(await a.data.next()).toEqual(bin);
    expect(await a.data.next()).toBe("a-text-2");
    expect(await b.data.next()).toBe("b-text");
    expect(await a.client.next()).toBe("to-a");
    expect(await a.client.next()).toEqual(bin);
    expect(await b.client.next()).toBe("to-b");
    await settle();
    expect(a.data.messages).toHaveLength(4);
    expect(b.data.messages).toHaveLength(2);
    expect(a.client.messages).toHaveLength(3);
    expect(b.client.messages).toHaveLength(2);
  });

  it("logs the control lifecycle, refusals, parked sockets and one summary line per pair (no payloads)", async () => {
    const lines: Array<{ msg: string; obj: Record<string, unknown> }> = [];
    const rec = (obj: unknown, msg?: string): void => {
      lines.push({
        msg: msg ?? String(obj),
        obj: typeof obj === "object" && obj ? (obj as Record<string, unknown>) : {},
      });
    };
    const logger: RelayLogger = {
      trace: rec,
      debug: rec,
      info: rec,
      warn: rec,
      error: rec,
      fatal: rec,
    };
    await start(undefined, logger);
    const control = await registerDaemon();
    const { client, data } = await pair(control);
    client.ws.send("secret-payload");
    await data.next();
    client.ws.close(1000, "bye");
    await data.closed;
    await settle();

    const refused = await open();
    refused.ws.send("nope");
    await refused.closed;
    const old = await open();
    old.ws.send(json({ type: "relay_register", sessionId: "legacy" }));
    await settle();

    const msgs = lines.map((l) => l.msg);
    expect(msgs).toContain("control socket registered");
    expect(msgs.some((m) => m.startsWith("refused"))).toBe(true);
    expect(msgs).toContain("parked old-protocol socket");
    const summaries = lines.filter((l) => l.msg === "pair closed");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.obj).toMatchObject({
      sessionId: SESSION,
      bytesToDaemon: "secret-payload".length,
      bytesToClient: 0,
      code: 1000,
      reason: "bye",
    });
    expect(summaries[0]!.obj.connectionId).toMatch(/^[0-9a-f]{32}$/);
    expect(typeof summaries[0]!.obj.timeToPairMs).toBe("number");
    expect(typeof summaries[0]!.obj.durationMs).toBe("number");
    expect(JSON.stringify(lines)).not.toContain("secret-payload");
  });
});

describe("refusals", () => {
  it.each([
    ["bad JSON", "not json"],
    ["a JSON array", "[]"],
    ["an unknown type", json({ type: "relay_hello", v: 2 })],
    ["v: 1", json({ type: "relay_client_connect", v: 1, sessionId: SESSION })],
    ["a bad session id", json({ type: "relay_client_connect", v: 2, sessionId: "short" })],
    [
      "a bad session id on register",
      json({ type: "relay_daemon_register", v: 2, sessionId: "XYZ" }),
    ],
    [
      "a bad connection id",
      json({ type: "relay_daemon_attach", v: 2, sessionId: SESSION, connectionId: "nope" }),
    ],
  ])("closes 4100 protocol_error for %s", async (_name, frame) => {
    await start();
    const p = await open();
    p.ws.send(frame);
    expectClose(await p.closed, RELAY_CLOSE.PROTOCOL_ERROR);
  });

  it("closes 4100 for a binary first frame", async () => {
    await start();
    const p = await open();
    p.ws.send(Buffer.from([1, 2, 3]));
    expectClose(await p.closed, RELAY_CLOSE.PROTOCOL_ERROR);
  });

  it("closes 4100 when a client sends a frame before relay_paired, and forgets it", async () => {
    await start();
    const control = await registerDaemon();
    const { client, connectionId } = await connectClient(control);
    client.ws.send("too early");
    expectClose(await client.closed, RELAY_CLOSE.PROTOCOL_ERROR);
    expect(handle!.counts().waiting).toBe(0);
    const data = await attach(connectionId);
    expectClose(await data.closed, RELAY_CLOSE.UNKNOWN_CONNECTION);
  });

  it("closes 4101 identify_timeout when no first frame arrives", async () => {
    await start({ identifyTimeoutMs: 60 });
    const p = await open();
    expectClose(await p.closed, RELAY_CLOSE.IDENTIFY_TIMEOUT);
  });

  it("does not time out a socket that identified in time", async () => {
    await start({ identifyTimeoutMs: 60 });
    const control = await registerDaemon();
    await settle(120);
    expect(control.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("closes 4102 daemon_offline when no control socket exists", async () => {
    await start();
    const p = await open();
    p.ws.send(json({ type: "relay_client_connect", v: 2, sessionId: SESSION }));
    expectClose(await p.closed, RELAY_CLOSE.DAEMON_OFFLINE);
  });

  it("closes 4103 daemon_unresponsive when the daemon does not attach, and a late attach gets 4106", async () => {
    await start({ attachTimeoutMs: 60 });
    const control = await registerDaemon();
    const { client, connectionId } = await connectClient(control);
    expectClose(await client.closed, RELAY_CLOSE.DAEMON_UNRESPONSIVE);
    expect(handle!.counts().waiting).toBe(0);
    const data = await attach(connectionId);
    expectClose(await data.closed, RELAY_CLOSE.UNKNOWN_CONNECTION);
  });

  it("closes 4104 too_many_clients for the 33rd client; after one leaves the next is accepted", async () => {
    await start();
    const control = await registerDaemon();
    const clients: Probe[] = [];
    for (let i = 0; i < 32; i++) clients.push((await connectClient(control)).client);
    const extra = await open();
    extra.ws.send(json({ type: "relay_client_connect", v: 2, sessionId: SESSION }));
    expectClose(await extra.closed, RELAY_CLOSE.TOO_MANY_CLIENTS);

    // Another session is not affected.
    const otherControl = await registerDaemon(OTHER_SESSION);
    await connectClient(otherControl, OTHER_SESSION);

    clients[0]!.ws.close();
    await clients[0]!.closed;
    await settle();
    const next = await connectClient(control);
    expect(next.connectionId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("counts paired connections toward the client limit", async () => {
    await start({ maxClientsPerDaemon: 2 });
    const control = await registerDaemon();
    const first = await pair(control);
    await pair(control);
    const extra = await open();
    extra.ws.send(json({ type: "relay_client_connect", v: 2, sessionId: SESSION }));
    expectClose(await extra.closed, RELAY_CLOSE.TOO_MANY_CLIENTS);
    first.client.ws.close(1000);
    await first.data.closed;
    await settle();
    await connectClient(control);
  });

  it("closes 4106 unknown_connection for an unknown id, another session's id, and a client already gone", async () => {
    await start();
    const control = await registerDaemon();
    const otherControl = await registerDaemon(OTHER_SESSION);

    const unknown = await attach("c".repeat(32));
    expectClose(await unknown.closed, RELAY_CLOSE.UNKNOWN_CONNECTION);

    const { client, connectionId } = await connectClient(control);
    const wrongSession = await attach(connectionId, OTHER_SESSION);
    expectClose(await wrongSession.closed, RELAY_CLOSE.UNKNOWN_CONNECTION);
    // The waiting entry survived the wrong attach.
    expect(handle!.counts().waiting).toBe(1);

    client.ws.close();
    await client.closed;
    await settle();
    const gone = await attach(connectionId);
    expectClose(await gone.closed, RELAY_CLOSE.UNKNOWN_CONNECTION);
    expect(otherControl.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("closes 4106 for a second attach of an already paired id", async () => {
    await start();
    const control = await registerDaemon();
    const { connectionId } = await pair(control);
    const again = await attach(connectionId);
    expectClose(await again.closed, RELAY_CLOSE.UNKNOWN_CONNECTION);
  });

  it("closes the older control socket 4107 replaced; its pairs keep forwarding", async () => {
    await start();
    const oldControl = await registerDaemon();
    const { client, data } = await pair(oldControl);
    const newControl = await registerDaemon();
    expectClose(await oldControl.closed, RELAY_CLOSE.REPLACED);
    expect(handle!.counts().controls).toBe(1);

    client.ws.send("still here");
    expect(await data.next()).toBe("still here");
    data.ws.send("and back");
    expect(await client.next()).toBe("and back");

    // New clients are dialed on the new control socket.
    await connectClient(newControl);
  });
});

describe("close forwarding", () => {
  it("forwards a forwardable close from the client to the data socket with the same code and reason", async () => {
    await start();
    const control = await registerDaemon();
    const { client, data } = await pair(control);
    client.ws.close(4000, "stale-connection-probe");
    expect(await data.closed).toEqual({ code: 4000, reason: "stale-connection-probe" });
    expect(handle!.counts().pairs).toBe(0);
  });

  it("forwards 1008 from the data socket to the client", async () => {
    await start();
    const control = await registerDaemon();
    const { client, data } = await pair(control);
    data.ws.close(1008, "invalid hello");
    expect(await client.closed).toEqual({ code: 1008, reason: "invalid hello" });
  });

  it("closes the other half with 4109 peer_closed for a code that cannot be forwarded", async () => {
    await start();
    const control = await registerDaemon();
    const { client, data } = await pair(control);
    // No close code at all (1005) cannot be sent by an application.
    client.ws.close();
    expectClose(await data.closed, RELAY_CLOSE.PEER_CLOSED);
  });

  it("closes the client with 4109 when the data socket drops abnormally", async () => {
    await start();
    const control = await registerDaemon();
    const { client, data } = await pair(control);
    data.ws.terminate();
    expectClose(await client.closed, RELAY_CLOSE.PEER_CLOSED);
  });
});

describe("old protocol", () => {
  it("parks a relay_register socket: no answer, nothing forwarded", async () => {
    await start();
    const old = await open();
    old.ws.send(json({ type: "relay_register", sessionId: "legacy-session" }));
    old.ws.send("anything");
    await settle();
    expect(old.messages).toEqual([]);
    expect(old.ws.readyState).toBe(WebSocket.OPEN);
    expect(handle!.counts().parked).toBe(1);

    old.ws.close();
    await old.closed;
    await settle();
    expect(handle!.counts().parked).toBe(0);
  });

  it("is not subject to the identify timer once parked", async () => {
    await start({ identifyTimeoutMs: 50 });
    const old = await open();
    old.ws.send(json({ type: "relay_register", sessionId: SESSION }));
    await settle(120);
    expect(old.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("answers daemon_outdated while only a silent parked socket exists, then daemon_offline once it speaks", async () => {
    await start();
    const old = await open();
    old.ws.send(json({ type: "relay_register", sessionId: SESSION }));
    await settle();

    const first = await open();
    first.ws.send(json({ type: "relay_client_connect", v: 2, sessionId: SESSION }));
    expectClose(await first.closed, RELAY_CLOSE.DAEMON_OUTDATED);

    old.ws.send("e2ee_hello");
    await settle();
    const second = await open();
    second.ws.send(json({ type: "relay_client_connect", v: 2, sessionId: SESSION }));
    expectClose(await second.closed, RELAY_CLOSE.DAEMON_OFFLINE);
    expect(old.messages).toEqual([]);
  });

  it("prefers a control socket over a parked one", async () => {
    await start();
    const old = await open();
    old.ws.send(json({ type: "relay_register", sessionId: SESSION }));
    await settle();
    const control = await registerDaemon();
    await connectClient(control);
    expect(old.messages).toEqual([]);
  });
});

describe("control socket lifetime", () => {
  it("keeps existing pairs forwarding after the control socket closes; new clients get daemon_offline only then", async () => {
    await start();
    const control = await registerDaemon();
    const { client, data } = await pair(control);
    const waitingClient = await connectClient(control);

    control.ws.close(1000);
    await control.closed;
    await settle();
    expect(handle!.counts()).toMatchObject({ controls: 0, pairs: 1, waiting: 1 });

    client.ws.send("ping");
    expect(await data.next()).toBe("ping");
    data.ws.send("pong");
    expect(await client.next()).toBe("pong");

    // The waiting client keeps waiting, and a daemon that got the dial can still attach.
    const waitingData = await attach(waitingClient.connectionId);
    expect(JSON.parse((await waitingClient.client.next()) as string).type).toBe("relay_paired");
    expect(JSON.parse((await waitingData.next()) as string).type).toBe("relay_paired");

    const fresh = await open();
    fresh.ws.send(json({ type: "relay_client_connect", v: 2, sessionId: SESSION }));
    expectClose(await fresh.closed, RELAY_CLOSE.DAEMON_OFFLINE);
  });

  it("does not delete a newer control socket when the replaced one closes", async () => {
    await start();
    const oldControl = await registerDaemon();
    const newControl = await registerDaemon();
    await oldControl.closed;
    await settle();
    expect(handle!.counts().controls).toBe(1);
    await connectClient(newControl);
  });
});

describe("frame size", () => {
  it("closes with 1009 on a frame above the configured limit", async () => {
    await start({ maxFrameBytes: 1024 });
    const control = await registerDaemon();
    const { client, data } = await pair(control);
    client.ws.send(Buffer.alloc(2048, 7));
    expect((await client.closed).code).toBe(1009);
    // The oversize socket ends with an abnormal close (1006), which is not forwardable.
    expectClose(await data.closed, RELAY_CLOSE.PEER_CLOSED);
  });

  it("forwards a frame at the limit", async () => {
    await start({ maxFrameBytes: 1024 });
    const control = await registerDaemon();
    const { client, data } = await pair(control);
    const frame = Buffer.alloc(1024, 7);
    client.ws.send(frame);
    expect(await data.next()).toEqual(frame);
  });
});

/** Wait until `check` holds, polling; fails the test after `timeoutMs`. */
async function until(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not reached in time");
    await settle(10);
  }
}

describe("flow control", () => {
  const FRAME = 32 * 1024;
  const FRAMES = 3072; // 96 MiB: far more than the kernel buffers along one hop can absorb
  const HIGH = 64 * 1024;
  const LOW = 16 * 1024;

  /** Frame `i` carries its index in the first 4 bytes. */
  function frame(i: number): Buffer {
    const buf = Buffer.alloc(FRAME, 1);
    buf.writeUInt32BE(i, 0);
    return buf;
  }

  it("stops reading a sender whose receiver does not read, bounds the queue, and resumes at the low mark", async () => {
    await start({ flowHighWaterBytes: HIGH, flowLowWaterBytes: LOW });
    const control = await registerDaemon();
    const { client, data } = await pair(control);

    // The client stops reading, so TCP fills toward the relay.
    client.ws.pause();
    for (let i = 0; i < FRAMES; i++) data.ws.send(frame(i));
    await until(() => handle!.flow().pausedDirections === 1);
    await settle(300);

    // The relay stopped reading the daemon, so the daemon's own queue holds nearly everything.
    expect(data.ws.bufferedAmount).toBeGreaterThan(32 * 1024 * 1024);
    // The relay's queue toward the client never grew past the high mark by more than a read chunk.
    expect(handle!.flow().peakQueuedBytes).toBeLessThan(HIGH + 512 * 1024);

    client.ws.resume();
    // `messages` also holds the `relay_paired` frame that `pair()` consumed.
    await until(() => client.messages.length === FRAMES + 1, 30_000);
    client.messages.slice(1).forEach((m, i) => expect((m as Buffer).readUInt32BE(0)).toBe(i));
    expect(handle!.flow().pausedDirections).toBe(0);
    expect(data.ws.bufferedAmount).toBe(0);
    expect(handle!.flow().peakQueuedBytes).toBeLessThan(HIGH + 512 * 1024);
  }, 60_000);

  it("keeps the other pair of the same daemon flowing while one pair is paused", async () => {
    await start({ flowHighWaterBytes: HIGH, flowLowWaterBytes: LOW });
    const control = await registerDaemon();
    const slow = await pair(control);
    const fast = await pair(control);

    slow.client.ws.pause();
    for (let i = 0; i < FRAMES; i++) slow.data.ws.send(frame(i));
    await until(() => handle!.flow().pausedDirections === 1);

    for (let i = 0; i < 20; i++) {
      fast.data.ws.send(`down ${i}`);
      expect(await fast.client.next()).toBe(`down ${i}`);
      fast.client.ws.send(`up ${i}`);
      expect(await fast.data.next()).toBe(`up ${i}`);
    }
    expect(handle!.flow().pausedDirections).toBe(1);
  }, 30_000);

  it("pauses each direction of a pair independently", async () => {
    await start({ flowHighWaterBytes: HIGH, flowLowWaterBytes: LOW });
    const control = await registerDaemon();
    const { client, data } = await pair(control);

    client.ws.pause();
    for (let i = 0; i < FRAMES; i++) data.ws.send(frame(i));
    await until(() => handle!.flow().pausedDirections === 1);

    // The client-to-daemon direction is not paused: the daemon still reads and the relay forwards.
    client.ws.send("up");
    expect(await data.next()).toBe("up");
    expect(handle!.flow().pausedDirections).toBe(1);
  }, 30_000);

  it("ends a paused pair cleanly when the receiver goes away", async () => {
    await start({ flowHighWaterBytes: HIGH, flowLowWaterBytes: LOW });
    const control = await registerDaemon();
    const { client, data } = await pair(control);

    client.ws.pause();
    for (let i = 0; i < FRAMES; i++) data.ws.send(frame(i));
    await until(() => handle!.flow().pausedDirections === 1);

    client.ws.terminate();
    await data.closed;
    await until(() => handle!.counts().pairs === 0);
    expect(handle!.flow().pausedDirections).toBe(0);
  }, 30_000);
});

describe("pings", () => {
  it("closes a socket that stops answering pings with 4108 after two unanswered pings", async () => {
    const interval = 60;
    await start({ pingIntervalMs: interval });
    const mute = await open({ autoPong: false });
    const startedAt = Date.now();
    mute.ws.send(json({ type: "relay_daemon_register", v: 2, sessionId: SESSION }));
    expectClose(await mute.closed, RELAY_CLOSE.PING_TIMEOUT);
    // Ping 1 at one interval, ping 2 at two, the verdict at three: never before two intervals.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2 * interval);
    await settle();
    expect(handle!.counts().controls).toBe(0);
  });

  it("keeps sockets that answer pings open, parked ones included", async () => {
    await start({ pingIntervalMs: 40 });
    const control = await registerDaemon();
    const old = await open();
    old.ws.send(json({ type: "relay_register", sessionId: "legacy-session" }));
    const { client, data } = await pair(control);
    await settle(40 * 8);
    for (const p of [control, old, client, data]) expect(p.ws.readyState).toBe(WebSocket.OPEN);
    expect(handle!.counts()).toMatchObject({ controls: 1, pairs: 1, parked: 1 });
  });

  it("closes the other half of a pair with 4108 when one half stops answering", async () => {
    await start({ pingIntervalMs: 60 });
    const control = await registerDaemon();
    const { client, connectionId } = await connectClient(control);
    const data = await open({ autoPong: false });
    data.ws.send(json({ type: "relay_daemon_attach", v: 2, sessionId: SESSION, connectionId }));
    expect(JSON.parse((await data.next()) as string).type).toBe("relay_paired");
    expect(JSON.parse((await client.next()) as string).type).toBe("relay_paired");
    expectClose(await client.closed, RELAY_CLOSE.PING_TIMEOUT);
    await until(() => handle!.counts().pairs === 0);
  });
});

describe("shutdown", () => {
  it("close() sends 1001 to every open socket", async () => {
    await start();
    const control = await registerDaemon();
    const { client, data } = await pair(control);
    const waitingClient = await connectClient(control);
    const fresh = await open();
    const old = await open();
    old.ws.send(json({ type: "relay_register", sessionId: "legacy-session" }));
    await settle();

    await handle!.close();
    handle = undefined;
    const probes = [control, client, data, waitingClient.client, fresh, old];
    for (const p of probes) expect((await p.closed).code).toBe(1001);
  });

  it("close() releases a paused sender and does not wait on a stuck socket forever", async () => {
    await start({ flowHighWaterBytes: 64 * 1024, flowLowWaterBytes: 16 * 1024 });
    const control = await registerDaemon();
    const { client, data } = await pair(control);
    client.ws.pause();
    for (let i = 0; i < 3072; i++) data.ws.send(Buffer.alloc(32 * 1024, 1));
    await until(() => handle!.flow().pausedDirections === 1);

    await handle!.close();
    handle = undefined;
    await until(() => data.ws.readyState === WebSocket.CLOSED, 5_000);
  }, 30_000);
});
