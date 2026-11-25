import { afterEach, describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { WebSocket } from "ws";

import { createClientChannel, RELAY_CLOSE, type Channel } from "@av-pi-studio/relay";
import { startRelayServer, type RelayServerHandle } from "@av-pi-studio/relay/server";

import { silentLogger } from "../logging/logger.js";
import {
  openRelayConnection,
  type RelayConnection,
  type RelayConnectionLimits,
} from "./relay-connection.js";

/**
 * Integration tests for the daemon's relay data socket (architecture/relay-protocol.md § Behavior —
 * Daemon (data socket)): the real relay server with short timers; the test plays the control role
 * with a raw socket and the client with a raw socket plus `createClientChannel`.
 */

const SESSION = "a".repeat(32);
const keypair = nacl.box.keyPair();

let relay: RelayServerHandle | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await relay?.close();
  relay = undefined;
});

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("until: timed out");
    await wait(5);
  }
}

interface Raw {
  ws: WebSocket;
  /** Text frames received, parsed lazily by the caller. */
  texts: string[];
  closed: Promise<{ code: number; reason: string }>;
}

async function openRaw(): Promise<Raw> {
  const ws = new WebSocket(`ws://127.0.0.1:${relay!.port}`);
  sockets.push(ws);
  const texts: string[] = [];
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (!isBinary) texts.push(data.toString("utf8"));
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on("close", (code, reason: Buffer) => resolve({ code, reason: reason.toString("utf8") }));
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return { ws, texts, closed };
}

async function startAll(): Promise<{ control: Raw }> {
  relay = await startRelayServer({ host: "127.0.0.1", port: 0 });
  const control = await openRaw();
  control.ws.send(JSON.stringify({ type: "relay_daemon_register", v: 2, sessionId: SESSION }));
  await until(() => control.texts.length >= 1);
  return { control };
}

const url = (): string => `ws://127.0.0.1:${relay!.port}`;

function open(connectionId: string, limits?: RelayConnectionLimits): RelayConnection {
  return openRelayConnection({
    url: url(),
    sessionId: SESSION,
    connectionId,
    keypair,
    limits,
    logger: silentLogger(),
  });
}

/** A client connects; the control socket receives the dial. */
async function dial(control: Raw): Promise<{ client: Raw; connectionId: string }> {
  const seen = control.texts.length;
  const client = await openRaw();
  client.ws.send(JSON.stringify({ type: "relay_client_connect", v: 2, sessionId: SESSION }));
  await until(() => control.texts.length > seen);
  const frame = JSON.parse(control.texts[seen]!) as { type: string; connectionId: string };
  expect(frame.type).toBe("relay_dial");
  return { client, connectionId: frame.connectionId };
}

interface ClientSide {
  client: Raw;
  channel: Channel;
  texts: string[];
  binaries: Uint8Array[];
}

/** Client side after `relay_paired`: a channel over the raw socket. */
async function startClientChannel(client: Raw, connectionId: string): Promise<ClientSide> {
  await until(() => client.texts.some((t) => t.includes("relay_paired")));
  expect(JSON.parse(client.texts[client.texts.length - 1]!)).toEqual({
    type: "relay_paired",
    connectionId,
  });
  const texts: string[] = [];
  const binaries: Uint8Array[] = [];
  let ready = false;
  const channel = createClientChannel({
    daemonPublicKey: keypair.publicKey,
    transport: {
      send: (bytes) => client.ws.send(bytes),
      onFrame: (h) =>
        client.ws.on("message", (data: Buffer, isBinary: boolean) =>
          h(isBinary ? new Uint8Array(data) : data.toString("utf8")),
        ),
      onClose: (h) => client.ws.on("close", (code, reason: Buffer) => h(code, reason.toString())),
      close: (code, reason) => client.ws.close(code, reason),
    },
    events: {
      onText: (t) => texts.push(t),
      onBinary: (b) => binaries.push(b),
      onReady: () => {
        ready = true;
      },
    },
  });
  await until(() => ready);
  return { client, channel, texts, binaries };
}

describe("openRelayConnection", () => {
  it("delivers client text and binary in order and sends both ways", async () => {
    const { control } = await startAll();
    const { client, connectionId } = await dial(control);
    const conn = open(connectionId);
    const gotText: string[] = [];
    const gotBinary: number[][] = [];
    const order: string[] = [];
    conn.onText((t) => {
      gotText.push(t);
      order.push(`t:${t}`);
    });
    conn.onBinary((b) => {
      gotBinary.push([...b]);
      order.push(`b:${b[0]}`);
    });
    const side = await startClientChannel(client, connectionId);
    await until(() => conn.isOpen);
    expect(conn.connectionId).toBe(connectionId);

    side.channel.send("one");
    side.channel.sendBinary(new Uint8Array([2]));
    side.channel.send("three");
    await until(() => order.length === 3);
    expect(order).toEqual(["t:one", "b:2", "t:three"]);
    expect(gotText).toEqual(["one", "three"]);
    expect(gotBinary).toEqual([[2]]);

    conn.sendText("a");
    conn.sendBinary(new Uint8Array([9, 8]));
    conn.sendText("c");
    await until(() => side.texts.length === 2 && side.binaries.length === 1);
    expect(side.texts).toEqual(["a", "c"]);
    expect([...side.binaries[0]!]).toEqual([9, 8]);
  });

  it("calls onReady once when the key exchange is done, and at once for a handler added later", async () => {
    const { control } = await startAll();
    const { client, connectionId } = await dial(control);
    const conn = open(connectionId);
    let ready = 0;
    conn.onReady(() => void ready++);
    expect(ready).toBe(0);

    await startClientChannel(client, connectionId);
    await until(() => ready === 1);
    let late = 0;
    conn.onReady(() => void late++);
    expect(late).toBe(1);
    expect(ready).toBe(1);
  });

  it("reports a numeric bufferedAmount that rises while the client is paused", async () => {
    const { control } = await startAll();
    const { client, connectionId } = await dial(control);
    const conn = open(connectionId);
    const side = await startClientChannel(client, connectionId);
    await until(() => conn.isOpen);
    expect(typeof conn.bufferedAmount).toBe("number");

    client.ws.pause();
    const chunk = new Uint8Array(256 * 1024);
    let peak = 0;
    for (let i = 0; i < 128; i++) {
      conn.sendBinary(chunk);
      peak = Math.max(peak, conn.bufferedAmount);
      if (i % 8 === 7) await wait(5);
    }
    await wait(50);
    peak = Math.max(peak, conn.bufferedAmount);
    expect(peak).toBeGreaterThan(1024 * 1024);

    client.ws.resume();
    await until(() => side.binaries.length === 128, 10_000);
    await until(() => conn.bufferedAmount === 0);
  });

  it("terminate() drops what the data socket still has queued after a close, and onClose fires once with the close code", async () => {
    const { control } = await startAll();
    const { client, connectionId } = await dial(control);
    const conn = open(connectionId);
    await startClientChannel(client, connectionId);
    await until(() => conn.isOpen);
    const closes: Array<[number, string]> = [];
    conn.onClose((c, r) => closes.push([c, r]));

    client.ws.pause(); // a client that stops reading
    const chunk = new Uint8Array(256 * 1024);
    for (let i = 0; i < 128; i++) {
      conn.sendBinary(chunk);
      if (i % 8 === 7) await wait(5);
    }
    await wait(50);
    expect(conn.bufferedAmount).toBeGreaterThan(0);

    conn.close(1013, "send queue full");
    conn.terminate();

    await until(() => conn.bufferedAmount === 0); // released once the destroyed socket has closed
    expect(conn.isOpen).toBe(false);
    await wait(20);
    expect(closes).toEqual([[1013, "send queue full"]]);
    client.ws.resume();
    await client.closed;
  });

  it("forwards close(1008, reason) to the client", async () => {
    const { control } = await startAll();
    const { client, connectionId } = await dial(control);
    const conn = open(connectionId);
    await startClientChannel(client, connectionId);
    await until(() => conn.isOpen);
    const closes: Array<[number, string]> = [];
    conn.onClose((c, r) => closes.push([c, r]));

    conn.close(1008, "invalid hello");
    expect(await client.closed).toEqual({ code: 1008, reason: "invalid hello" });
    expect(conn.isOpen).toBe(false);
    await wait(20);
    expect(closes).toEqual([[1008, "invalid hello"]]);
  });

  it("closes a paired socket whose client never sends a channel hello, firing onClose once", async () => {
    const { control } = await startAll();
    const { client, connectionId } = await dial(control);
    const conn = open(connectionId, { keyExchangeTimeoutMs: 100 });
    const closes: Array<[number, string]> = [];
    conn.onClose((c, r) => closes.push([c, r]));
    await until(() => client.texts.some((t) => t.includes("relay_paired")));

    await until(() => closes.length > 0);
    await wait(60);
    expect(closes).toEqual([[RELAY_CLOSE.PROTOCOL_ERROR.code, RELAY_CLOSE.PROTOCOL_ERROR.reason]]);
    expect((await client.closed).code).toBe(RELAY_CLOSE.PROTOCOL_ERROR.code);
    expect(conn.isOpen).toBe(false);
  });

  it("closes a socket that hears nothing for the silence timeout", async () => {
    const { control } = await startAll();
    const { client, connectionId } = await dial(control);
    const conn = open(connectionId, { silenceTimeoutMs: 150 });
    const closes: Array<[number, string]> = [];
    conn.onClose((c, r) => closes.push([c, r]));
    await startClientChannel(client, connectionId);
    await until(() => closes.length > 0);
    expect(closes[0]![0]).toBe(RELAY_CLOSE.PING_TIMEOUT.code);
  });

  it("fires onClose with the forwarded code when the client closes", async () => {
    const { control } = await startAll();
    const { client, connectionId } = await dial(control);
    const conn = open(connectionId);
    const closes: Array<[number, string]> = [];
    conn.onClose((c, r) => closes.push([c, r]));
    await startClientChannel(client, connectionId);
    await until(() => conn.isOpen);

    client.ws.close(4001, "bye");
    await until(() => closes.length > 0);
    await wait(20);
    expect(closes).toEqual([[4001, "bye"]]);
  });

  it("ends in onClose with 4106 when the relay does not know the connection id", async () => {
    await startAll();
    const conn = open("f".repeat(32));
    const code = await new Promise<number>((resolve) => conn.onClose((c) => resolve(c)));
    expect(code).toBe(RELAY_CLOSE.UNKNOWN_CONNECTION.code);
    expect(conn.isOpen).toBe(false);
  });
});
