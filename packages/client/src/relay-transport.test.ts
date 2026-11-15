import { type AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";

import nacl from "tweetnacl";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket as NodeWebSocket, WebSocketServer } from "ws";

import {
  createDaemonChannel,
  deriveRelaySessionId,
  RELAY_CLOSE,
  type Channel,
} from "@av-pi-studio/relay";
import {
  startRelayServer,
  type RelayLimits,
  type RelayServerHandle,
} from "@av-pi-studio/relay/server";

import { parsePairingUrl } from "./pairing.js";
import {
  createRelayTransport,
  relayDialUrl,
  RelayConnectError,
  type RelayConnectReason,
} from "./relay-transport.js";
import type { Transport } from "./transport.js";

/**
 * Integration tests for the protocol-2 client relay transport (architecture/relay-protocol.md
 * § Behavior — Client; features/relay-multi-client.md § Public contract 3): the REAL relay server
 * plus a minimal in-test daemon stand-in (raw control socket + data socket + `createDaemonChannel`).
 */

const daemonKeys = nacl.box.keyPair();
const SESSION = deriveRelaySessionId(daemonKeys.publicKey);

let relay: RelayServerHandle | undefined;
const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanups.splice(0).toReversed()) await fn();
  await relay?.close();
  relay = undefined;
});

async function startRelay(limits?: Partial<RelayLimits>): Promise<string> {
  relay = await startRelayServer({ host: "127.0.0.1", port: 0, limits });
  return `ws://127.0.0.1:${relay.port}`;
}

const settle = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface DaemonStandIn {
  /** Every plaintext text/binary message the daemon received, in order. */
  texts: string[];
  binaries: Uint8Array[];
  /** Every channel (one per dialed connection). */
  channels: Channel[];
  /** Raw first-frame strings the data sockets sent to the relay, for ordering checks. */
  closeEvents: Array<{ code?: number; reason?: string }>;
}

/** Register a control socket and answer each `relay_dial` with a data socket + daemon channel. */
async function startDaemon(
  url: string,
  opts: { ignoreDial?: boolean; keys?: nacl.BoxKeyPair; echo?: boolean } = {},
): Promise<DaemonStandIn> {
  const stand: DaemonStandIn = { texts: [], binaries: [], channels: [], closeEvents: [] };
  const control = new NodeWebSocket(url);
  cleanups.push(() => control.terminate());
  const registered = new Promise<void>((resolve, reject) => {
    control.once("error", reject);
    control.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      const frame = JSON.parse(data.toString("utf8")) as { type: string; connectionId?: string };
      if (frame.type === "relay_registered") resolve();
      if (frame.type !== "relay_dial" || opts.ignoreDial) return;
      attachData(url, frame.connectionId!, stand, opts);
    });
  });
  await new Promise<void>((resolve) => control.once("open", () => resolve()));
  control.send(JSON.stringify({ type: "relay_daemon_register", v: 2, sessionId: SESSION }));
  await registered;
  return stand;
}

function attachData(
  url: string,
  connectionId: string,
  stand: DaemonStandIn,
  opts: { keys?: nacl.BoxKeyPair; echo?: boolean },
): void {
  const data = new NodeWebSocket(url);
  cleanups.push(() => data.terminate());
  let frameHandler: ((f: Uint8Array | string) => void) | null = null;
  let closeHandler: ((code?: number, reason?: string) => void) | null = null;
  let paired = false;
  const channel = createDaemonChannel({
    daemonKeypair: opts.keys ?? daemonKeys,
    transport: {
      send: (bytes) => data.send(bytes),
      onFrame: (h) => {
        frameHandler = h;
      },
      onClose: (h) => {
        closeHandler = h;
      },
      close: (code, reason) => data.close(code, reason),
    },
    events: {
      onText: (text) => {
        stand.texts.push(text);
        if (opts.echo) channel.send(`echo:${text}`);
      },
      onBinary: (bytes) => {
        stand.binaries.push(bytes);
        if (opts.echo) channel.sendBinary(bytes);
      },
      onClose: (code, reason) => stand.closeEvents.push({ code, reason }),
    },
  });
  stand.channels.push(channel);
  data.on("open", () =>
    data.send(
      JSON.stringify({ type: "relay_daemon_attach", v: 2, sessionId: SESSION, connectionId }),
    ),
  );
  data.on("message", (raw: Buffer, isBinary: boolean) => {
    if (!paired) {
      // The first text frame is `relay_paired`.
      paired = true;
      return;
    }
    frameHandler?.(isBinary ? new Uint8Array(raw) : raw.toString("utf8"));
  });
  data.on("close", (code, reason: Buffer) => closeHandler?.(code, reason.toString("utf8")));
}

function newTransport(
  extra: { connectTimeoutMs?: number; daemonPublicKey?: Uint8Array } = {},
): Transport {
  const transport = createRelayTransport({
    daemonPublicKey: daemonKeys.publicKey,
    ...extra,
  });
  cleanups.push(() => transport.close());
  return transport;
}

async function expectRefusal(promise: Promise<void>): Promise<RelayConnectError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RelayConnectError);
  return error as RelayConnectError;
}

function expectReason(error: RelayConnectError, reason: RelayConnectReason): void {
  expect(error.reason).toBe(reason);
  expect(error.name).toBe("RelayConnectError");
}

describe("client relay transport (protocol 2)", () => {
  it("connects after ready; text and binary round-trip; binary arrives as ArrayBuffer", async () => {
    const url = await startRelay();
    const daemon = await startDaemon(url, { echo: true });
    const transport = newTransport();
    const received: Array<string | ArrayBuffer | Blob> = [];
    transport.onMessage = (data) => received.push(data);

    expect(transport.isOpen).toBe(false);
    expect(() => transport.sendText("early")).toThrow();
    await transport.connect(url);
    expect(transport.isOpen).toBe(true);
    expect(typeof transport.bufferedAmount).toBe("number");

    transport.sendText("héllo");
    transport.sendBinary(new Uint8Array([1, 2, 3]));
    transport.sendText("again");
    await settle(100);

    expect(daemon.texts).toEqual(["héllo", "again"]);
    expect(daemon.binaries.map((b) => Array.from(b))).toEqual([[1, 2, 3]]);
    // Wire order, text as strings, binary as ArrayBuffer.
    expect(received[0]).toBe("echo:héllo");
    expect(received[1]).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(received[1] as ArrayBuffer))).toEqual([1, 2, 3]);
    expect(received[2]).toBe("echo:again");
  });

  it("rejects at once with daemon_offline when no daemon is registered", async () => {
    const url = await startRelay();
    const started = Date.now();
    const error = await expectRefusal(newTransport().connect(url));
    expect(Date.now() - started).toBeLessThan(1000);
    expectReason(error, "daemon_offline");
    expect(error.message).toMatch(/offline/);
    expect(error.message).toMatch(/key replaced/);
    expect(error.message).toMatch(/no longer valid/);
  });

  it("tells its owner the transport closed after a refused connect (so DaemonClient leaves connecting)", async () => {
    const url = await startRelay();
    const transport = newTransport();
    const closes: Array<[number, string]> = [];
    transport.onClose = (code, reason) => closes.push([code, reason]);
    expectReason(await expectRefusal(transport.connect(url)), "daemon_offline");
    expect(closes.length).toBe(1);
    expect(closes[0]![1]).toMatch(/offline/);
    await settle(100);
    expect(closes.length).toBe(1);
  });

  it("rejects with daemon_unresponsive when the daemon ignores relay_dial", async () => {
    const url = await startRelay({ attachTimeoutMs: 80 });
    await startDaemon(url, { ignoreDial: true });
    const error = await expectRefusal(newTransport().connect(url));
    expectReason(error, "daemon_unresponsive");
    expect(error.message).toMatch(/did not answer/);
  });

  it("rejects the client past the cap with too_many_clients", async () => {
    const url = await startRelay({ maxClientsPerDaemon: 2 });
    await startDaemon(url);
    await newTransport().connect(url);
    await newTransport().connect(url);
    const error = await expectRefusal(newTransport().connect(url));
    expectReason(error, "too_many_clients");
    expect(error.message).toMatch(/maximum number of relay connections/);
  });

  it("rejects with daemon_outdated when only a silent parked relay_register socket exists", async () => {
    const url = await startRelay();
    const old = new NodeWebSocket(url);
    cleanups.push(() => old.terminate());
    await new Promise<void>((resolve) => old.once("open", () => resolve()));
    old.send(JSON.stringify({ type: "relay_register", sessionId: SESSION }));
    await settle();
    const error = await expectRefusal(newTransport().connect(url));
    expectReason(error, "daemon_outdated");
    expect(error.message).toMatch(/older relay protocol/);
    expect(error.message).toMatch(/updated/);
  });

  it("rejects with wrong_key when the ready box does not open, sending nothing after hello", async () => {
    const url = await startRelay();
    // The daemon holds a different key than the one in the pairing link.
    const daemon = await startDaemon(url, { keys: nacl.box.keyPair() });
    const transport = newTransport();
    const error = await expectRefusal(transport.connect(url));
    expectReason(error, "wrong_key");
    expect(error.message).toMatch(/does not match this daemon/);
    await settle();
    // The daemon saw only the hello: no application record ever arrived.
    expect(daemon.texts).toEqual([]);
    expect(daemon.binaries).toEqual([]);
    expect(transport.isOpen).toBe(false);
  });

  it("rejects with timeout after connectTimeoutMs when the server never answers", async () => {
    const http: Server = createServer();
    const wss = new WebSocketServer({ server: http });
    const sockets: NodeWebSocket[] = [];
    wss.on("connection", (s: NodeWebSocket) => sockets.push(s));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => {
      for (const s of sockets) s.terminate();
      await new Promise<void>((resolve) => wss.close(() => http.close(() => resolve())));
    });
    const port = (http.address() as AddressInfo).port;

    const started = Date.now();
    const error = await expectRefusal(
      newTransport({ connectTimeoutMs: 150 }).connect(`ws://127.0.0.1:${port}`),
    );
    expectReason(error, "timeout");
    expect(error.message).toMatch(/did not answer in time/);
    expect(error.message).toMatch(/self-hosted relay may need updating/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    await settle();
    expect(sockets[0]!.readyState).not.toBe(NodeWebSocket.OPEN);
  });

  it("rejects with relay_unreachable for a port nothing listens on", async () => {
    const http = createServer();
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const port = (http.address() as AddressInfo).port;
    await new Promise<void>((resolve) => http.close(() => resolve()));
    const error = await expectRefusal(newTransport().connect(`ws://127.0.0.1:${port}`));
    expectReason(error, "relay_unreachable");
  });

  it("rejects with protocol_error for a relay close without a named refusal", async () => {
    const http: Server = createServer();
    const wss = new WebSocketServer({ server: http });
    wss.on("connection", (s: NodeWebSocket) => s.close(RELAY_CLOSE.PROTOCOL_ERROR.code, "nope"));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () => new Promise<void>((resolve) => wss.close(() => http.close(() => resolve()))),
    );
    const port = (http.address() as AddressInfo).port;
    const error = await expectRefusal(newTransport().connect(`ws://127.0.0.1:${port}`));
    expectReason(error, "protocol_error");
  });

  it("reports onError then onClose 4200 when a frame is tampered after connect", async () => {
    const url = await startRelay();
    await startDaemon(url, { echo: true });

    // A proxy between client and relay that corrupts daemon-to-client records once armed.
    let tamper = false;
    const http: Server = createServer();
    const proxy = new WebSocketServer({ server: http });
    proxy.on("connection", (client: NodeWebSocket) => {
      const upstream = new NodeWebSocket(url);
      const backlog: Array<[Buffer, boolean]> = [];
      client.on("message", (d: Buffer, bin: boolean) => {
        if (upstream.readyState === NodeWebSocket.OPEN) upstream.send(d, { binary: bin });
        else backlog.push([d, bin]);
      });
      upstream.on("open", () => {
        for (const [d, bin] of backlog.splice(0)) upstream.send(d, { binary: bin });
      });
      upstream.on("message", (d: Buffer, bin: boolean) => {
        if (tamper && bin) d[d.length - 1] = (d[d.length - 1] ?? 0) ^ 0xff;
        client.send(d, { binary: bin });
      });
      client.on("close", () => upstream.close());
      upstream.on("close", () => client.close());
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => {
      for (const c of proxy.clients) c.terminate();
      await new Promise<void>((resolve) => proxy.close(() => http.close(() => resolve())));
    });

    const transport = newTransport();
    const events: string[] = [];
    let closeArgs: [number, string] | undefined;
    transport.onError = () => events.push("error");
    transport.onClose = (code, reason) => {
      events.push("close");
      closeArgs = [code, reason];
    };
    await transport.connect(`ws://127.0.0.1:${(http.address() as AddressInfo).port}`);
    tamper = true;
    transport.sendText("trigger");
    await settle(150);

    expect(events).toEqual(["error", "close"]);
    expect(closeArgs).toEqual([RELAY_CLOSE.CHANNEL_ERROR.code, RELAY_CLOSE.CHANNEL_ERROR.reason]);
    expect(transport.isOpen).toBe(false);
  });

  it("forwards a close from the daemon with its code and reason", async () => {
    const url = await startRelay();
    const daemon = await startDaemon(url);
    const transport = newTransport();
    const closed = Promise.withResolvers<[number, string]>();
    transport.onClose = (code, reason) => closed.resolve([code, reason]);
    await transport.connect(url);
    daemon.channels[0]!.close(1008, "policy");
    expect(await closed.promise).toEqual([1008, "policy"]);
    expect(transport.isOpen).toBe(false);
  });

  it("can connect again on the same transport after the daemon closed it (DaemonClient reconnect)", async () => {
    const url = await startRelay();
    const daemon = await startDaemon(url, { echo: true });
    const transport = newTransport();
    const received: Array<string | ArrayBuffer | Blob> = [];
    const closes: Array<[number, string]> = [];
    transport.onMessage = (data) => received.push(data);
    transport.onClose = (code, reason) => closes.push([code, reason]);

    await transport.connect(url);
    daemon.channels[0]!.close(1001, "daemon shutting down");
    await expect.poll(() => closes.length).toBe(1);
    expect(closes[0]).toEqual([1001, "daemon shutting down"]);
    expect(transport.isOpen).toBe(false);

    await transport.connect(url);
    expect(transport.isOpen).toBe(true);
    transport.sendText("second life");
    await expect.poll(() => received.length).toBe(1);
    expect(received[0]).toBe("echo:second life");
    // The first connection's late events never touched the second one.
    expect(closes.length).toBe(1);
  });

  it("can retry on the same transport after a refusal", async () => {
    const url = await startRelay();
    const transport = newTransport();
    expectReason(await expectRefusal(transport.connect(url)), "daemon_offline");

    await startDaemon(url, { echo: true });
    await transport.connect(url);
    expect(transport.isOpen).toBe(true);
  });

  it("rejects a second connect() while one is connecting or open", async () => {
    const url = await startRelay();
    await startDaemon(url);
    const transport = newTransport();
    await transport.connect(url);
    await expect(transport.connect(url)).rejects.toThrow(/already/);
  });

  it("close() ends the connection and fires onClose once with the given code", async () => {
    const url = await startRelay();
    const daemon = await startDaemon(url);
    const transport = newTransport();
    const closes: Array<[number, string]> = [];
    transport.onClose = (code, reason) => closes.push([code, reason]);
    await transport.connect(url);
    transport.close(1000, "bye");
    await settle(100);
    expect(closes).toEqual([[1000, "bye"]]);
    expect(daemon.closeEvents.length).toBe(1);
  });

  it("defaults sessionId to deriveRelaySessionId(daemonPublicKey)", async () => {
    const url = await startRelay();
    await startDaemon(url);
    // No explicit sessionId: reaching the daemon proves the derived id matched its registration.
    await newTransport().connect(url);
  });

  it("relayDialUrl maps useTls to wss/ws and strips a redundant scheme prefix", () => {
    expect(relayDialUrl({ endpoint: "relay.example.com", useTls: true })).toBe(
      "wss://relay.example.com",
    );
    expect(relayDialUrl({ endpoint: "127.0.0.1:7000", useTls: false })).toBe("ws://127.0.0.1:7000");
    expect(relayDialUrl({ endpoint: "wss://already-schemed.example/", useTls: true })).toBe(
      "wss://already-schemed.example",
    );
  });

  it("relayDialUrl also strips an http(s):// scheme, never concatenating two schemes", () => {
    expect(relayDialUrl({ endpoint: "https://relay.molagent.ai", useTls: true })).toBe(
      "wss://relay.molagent.ai",
    );
    expect(relayDialUrl({ endpoint: "http://relay.molagent.ai", useTls: false })).toBe(
      "ws://relay.molagent.ai",
    );
  });
});

describe("pairing URL fragment parsing", () => {
  it("extracts the offer public key and optional host from a full pairing URL", () => {
    const keypair = nacl.box.keyPair();
    const publicKeyB64 = Buffer.from(keypair.publicKey).toString("base64");
    const url = `https://app.pi-studio.sh/#offer=${encodeURIComponent(publicKeyB64)}&host=127.0.0.1%3A6767`;

    const offer = parsePairingUrl(url);
    expect(offer).not.toBeNull();
    expect(offer!.publicKeyB64).toBe(publicKeyB64);
    expect(Array.from(offer!.publicKey)).toEqual(Array.from(keypair.publicKey));
    expect(offer!.host).toBe("127.0.0.1:6767");
  });

  it("never reaches the web origin (only the fragment is parsed, never a query/path segment)", () => {
    const keypair = nacl.box.keyPair();
    const publicKeyB64 = Buffer.from(keypair.publicKey).toString("base64");
    // The pairing key must NEVER appear before the `#` — simulate the origin-visible portion by
    // parsing a URL where the origin-visible query string carries a decoy, and the real key is
    // only in the fragment.
    const url = `https://app.pi-studio.sh/?tracking=1#offer=${encodeURIComponent(publicKeyB64)}`;
    const originVisiblePart = url.split("#")[0]!;
    expect(originVisiblePart).not.toContain(publicKeyB64);

    const offer = parsePairingUrl(url);
    expect(offer!.publicKeyB64).toBe(publicKeyB64);
  });

  it("returns null for a URL with no offer parameter", () => {
    expect(parsePairingUrl("https://app.pi-studio.sh/#other=1")).toBeNull();
    expect(parsePairingUrl("https://app.pi-studio.sh/")).toBeNull();
  });

  it("accepts a bare fragment (no scheme/host) for programmatic construction", () => {
    const keypair = nacl.box.keyPair();
    const publicKeyB64 = Buffer.from(keypair.publicKey).toString("base64");
    const offer = parsePairingUrl(`#offer=${encodeURIComponent(publicKeyB64)}`);
    expect(offer!.publicKeyB64).toBe(publicKeyB64);
  });

  it("extracts relay endpoint + TLS flag, omitting host, when the link is relay-routed", () => {
    const keypair = nacl.box.keyPair();
    const publicKeyB64 = Buffer.from(keypair.publicKey).toString("base64");
    const url = `https://app.pi-studio.sh/#offer=${encodeURIComponent(publicKeyB64)}&relay=relay.molagent.ai&relayTls=1`;

    const offer = parsePairingUrl(url);
    expect(offer).not.toBeNull();
    expect(offer!.relay).toEqual({ endpoint: "relay.molagent.ai", useTls: true });
    expect(offer!.host).toBeUndefined();
  });

  it("treats relayTls=0 (or an absent value) as non-TLS", () => {
    const keypair = nacl.box.keyPair();
    const publicKeyB64 = Buffer.from(keypair.publicKey).toString("base64");
    const offer = parsePairingUrl(
      `#offer=${encodeURIComponent(publicKeyB64)}&relay=127.0.0.1%3A7000&relayTls=0`,
    );
    expect(offer!.relay).toEqual({ endpoint: "127.0.0.1:7000", useTls: false });
  });
});
