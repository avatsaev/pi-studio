import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { WebSocketServer, WebSocket } from "ws";

import { RelaySessionBridge, type RelaySocket } from "./session-bridge.js";
import { createDaemonChannel, createClientChannel } from "./channel.js";

/**
 * Tests `RelaySessionBridge` against REAL, independent WebSocket connections (one server, N
 * clients) rather than an in-process fake pair — a daemon and a client are always two SEPARATE
 * connections into the relay, bridged only by session id, never wired to each other directly.
 * This mirrors exactly how `cf-adapter.ts` and the real relay deployment would use the bridge.
 */

interface TestRelay {
  port: number;
  bridge: RelaySessionBridge;
  close(): Promise<void>;
  /** Open a real client-role socket into the test relay. */
  connect(): Promise<WebSocket>;
}

function wrapWsSocket(ws: WebSocket): RelaySocket {
  const messageHandlers: Array<(data: string) => void> = [];
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (!isBinary) for (const h of messageHandlers) h(data.toString("utf8"));
  });
  return {
    send: (data) => ws.send(data),
    onMessage: (h) => messageHandlers.push(h),
    onClose: (h) => ws.on("close", (code, reasonBuf: Buffer) => h(reasonBuf.toString("utf8") || `code ${code}`)),
    close: (code, reason) => ws.close(code, reason),
  };
}

async function startTestRelay(): Promise<TestRelay> {
  const http: Server = createServer();
  const wss = new WebSocketServer({ server: http });
  const bridge = new RelaySessionBridge();
  wss.on("connection", (ws: WebSocket) => bridge.attach(wrapWsSocket(ws)));

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
  const port = (http.address() as AddressInfo).port;
  return {
    port,
    bridge,
    async close() {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
    connect(): Promise<WebSocket> {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      return new Promise((resolve, reject) => {
        ws.once("open", () => resolve(ws));
        ws.once("error", reject);
      });
    },
  };
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => ws.once("message", (data: Buffer) => resolve(data.toString("utf8"))));
}

let relay: TestRelay | undefined;
const openSockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of openSockets) s.close();
  openSockets.length = 0;
  await relay?.close();
  relay = undefined;
});

describe("RelaySessionBridge", () => {
  it("a daemon registers a session id and a client attaches to the same session and is bridged", async () => {
    relay = await startTestRelay();
    const daemon = await relay.connect();
    const client = await relay.connect();
    openSockets.push(daemon, client);

    daemon.send(JSON.stringify({ type: "relay_register", sessionId: "sess-1" }));
    client.send(JSON.stringify({ type: "relay_register", sessionId: "sess-1" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(relay.bridge.peerCount("sess-1")).toBe(2);

    const clientReceived = nextMessage(client);
    daemon.send("hello-from-daemon");
    expect(await clientReceived).toBe("hello-from-daemon");

    const daemonReceived = nextMessage(daemon);
    client.send("hello-from-client");
    expect(await daemonReceived).toBe("hello-from-client");
  });

  it("forwards frames verbatim without inspecting them — an opaque ciphertext-shaped string round-trips byte-for-byte", async () => {
    relay = await startTestRelay();
    const daemon = await relay.connect();
    const client = await relay.connect();
    openSockets.push(daemon, client);

    daemon.send(JSON.stringify({ type: "relay_register", sessionId: "sess-2" }));
    client.send(JSON.stringify({ type: "relay_register", sessionId: "sess-2" }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    const opaqueFrame = JSON.stringify({ type: "e2ee_app", frame: "not-real-but-opaque==garbage%%%" });
    const clientReceived = nextMessage(client);
    daemon.send(opaqueFrame);
    expect(await clientReceived).toBe(opaqueFrame);
  });

  it("the bridge cannot read/forge/inject — a real E2EE handshake + app message crosses it with no plaintext ever visible on the wire", async () => {
    relay = await startTestRelay();
    const daemonSocket = await relay.connect();
    const clientSocket = await relay.connect();
    openSockets.push(daemonSocket, clientSocket);

    // Record every raw frame either socket transmits — this is exactly what a compromised relay
    // operator could observe (nothing more, nothing less).
    const wireFrames: string[] = [];
    const originalDaemonSend = daemonSocket.send.bind(daemonSocket);
    daemonSocket.send = ((data: string) => {
      wireFrames.push(data);
      originalDaemonSend(data);
    }) as typeof daemonSocket.send;
    const originalClientSend = clientSocket.send.bind(clientSocket);
    clientSocket.send = ((data: string) => {
      wireFrames.push(data);
      originalClientSend(data);
    }) as typeof clientSocket.send;

    const sessionId = "sess-3";
    daemonSocket.send(JSON.stringify({ type: "relay_register", sessionId }));
    clientSocket.send(JSON.stringify({ type: "relay_register", sessionId }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    const daemonKeypair = nacl.box.keyPair();
    const daemonMessages: string[] = [];
    const daemonReady = Promise.withResolvers<void>();
    const daemonAppTransport = wrapWsSocket(daemonSocket);
    createDaemonChannel({
      transport: {
        send: (d) => daemonAppTransport.send(d),
        onMessage: (h) => daemonAppTransport.onMessage(h),
        onClose: () => {},
        close: () => {},
      },
      attachment: { sessionId },
      daemonKeypair,
      events: { onMessage: (m) => daemonMessages.push(m), onReady: () => daemonReady.resolve() },
    });

    const clientReady = Promise.withResolvers<void>();
    const clientAppTransport = wrapWsSocket(clientSocket);
    const clientChannel = createClientChannel({
      transport: {
        send: (d) => clientAppTransport.send(d),
        onMessage: (h) => clientAppTransport.onMessage(h),
        onClose: () => {},
        close: () => {},
      },
      attachment: { sessionId },
      daemonPublicKey: daemonKeypair.publicKey,
      events: { onReady: () => clientReady.resolve() },
    });

    await Promise.all([daemonReady.promise, clientReady.promise]);

    const SECRET = "top-secret-app-payload-the-relay-must-never-see";
    clientChannel.send(SECRET);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The daemon actually decrypted it — proving the message traveled and authenticated.
    expect(daemonMessages).toEqual([SECRET]);

    // Yet not one frame ever transmitted on the wire contains the plaintext or the daemon's raw
    // secret key — only the ciphertext (`e2ee_app`) and the plaintext EPHEMERAL public key
    // (`e2ee_hello`), exactly what the spec allows a compromised relay to see.
    const daemonSecretB64 = Buffer.from(daemonKeypair.secretKey).toString("base64");
    for (const frame of wireFrames) {
      expect(frame).not.toContain(SECRET);
      expect(frame).not.toContain(daemonSecretB64);
    }
    expect(wireFrames.some((f) => f.includes("e2ee_app"))).toBe(true);
  });

  it("relay restart/drop → client and daemon reconnect into a new session with new keys (fresh bridge instance, no leftover state)", async () => {
    const relay1 = await startTestRelay();
    const daemon1 = await relay1.connect();
    const client1 = await relay1.connect();
    daemon1.send(JSON.stringify({ type: "relay_register", sessionId: "sess-old" }));
    client1.send(JSON.stringify({ type: "relay_register", sessionId: "sess-old" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(relay1.bridge.peerCount("sess-old")).toBe(2);
    daemon1.close();
    client1.close();
    await relay1.close();

    // A relay restart/drop, in Cloudflare terms, means a fresh Durable Object / bridge instance —
    // the old session id carries no state forward.
    relay = await startTestRelay();
    expect(relay.bridge.peerCount("sess-old")).toBe(0);

    const daemon2 = await relay.connect();
    const client2 = await relay.connect();
    openSockets.push(daemon2, client2);
    daemon2.send(JSON.stringify({ type: "relay_register", sessionId: "sess-new" }));
    client2.send(JSON.stringify({ type: "relay_register", sessionId: "sess-new" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(relay.bridge.peerCount("sess-new")).toBe(2);
  });

  it("removes a socket from its session on close, and ignores frames from an unregistered socket", async () => {
    relay = await startTestRelay();
    const daemon = await relay.connect();
    const client = await relay.connect();
    openSockets.push(client);

    daemon.send(JSON.stringify({ type: "relay_register", sessionId: "sess-4" }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    // `client` never registers — its plain-text frame must be ignored, not treated as registration.
    const daemonReceivedFrames: string[] = [];
    daemon.on("message", (data: Buffer) => daemonReceivedFrames.push(data.toString("utf8")));
    client.send("not-a-registration-frame");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(daemonReceivedFrames).toEqual([]);
    expect(relay.bridge.peerCount("sess-4")).toBe(1);

    daemon.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(relay.bridge.peerCount("sess-4")).toBe(0);
  });
});

/**
 * Metadata-only event hooks (`RelayBridgeEvents`) — what the relay server's operational logging
 * subscribes to. In-memory fake sockets keep these deterministic (no network timing).
 */
describe("RelaySessionBridge events", () => {
  /** Minimal in-memory RelaySocket: capture sent frames, expose emit/close test triggers. */
  function fakeSocket() {
    const sent: string[] = [];
    const messageHandlers: Array<(data: string) => void> = [];
    const closeHandlers: Array<(reason?: string) => void> = [];
    const socket: RelaySocket = {
      send: (d) => void sent.push(d),
      onMessage: (h) => messageHandlers.push(h),
      onClose: (h) => closeHandlers.push(h),
      close: () => undefined,
    };
    return {
      socket,
      sent,
      emit: (d: string) => messageHandlers.forEach((h) => h(d)),
      emitClose: () => closeHandlers.forEach((h) => h()),
    };
  }

  it("fires onRegister with the session id and post-add peer count", () => {
    const events: Array<{ sessionId: string; peers: number }> = [];
    const bridge = new RelaySessionBridge({
      onRegister: (_s, sessionId, peers) => events.push({ sessionId, peers }),
    });
    const a = fakeSocket();
    const b = fakeSocket();
    bridge.attach(a.socket);
    bridge.attach(b.socket);
    a.emit(JSON.stringify({ type: "relay_register", sessionId: "s1" }));
    b.emit(JSON.stringify({ type: "relay_register", sessionId: "s1" }));
    expect(events).toEqual([
      { sessionId: "s1", peers: 1 },
      { sessionId: "s1", peers: 2 },
    ]);
  });

  it("fires onRegisterRejected for a non-registration first frame, without registering the socket", () => {
    let rejected = 0;
    const bridge = new RelaySessionBridge({ onRegisterRejected: () => rejected++ });
    const a = fakeSocket();
    bridge.attach(a.socket);
    a.emit("not json at all");
    a.emit(JSON.stringify({ type: "something_else" }));
    expect(rejected).toBe(2);
    expect(bridge.peerCount("s1")).toBe(0);
    // The socket can still register later (behavior unchanged by the hook).
    a.emit(JSON.stringify({ type: "relay_register", sessionId: "s1" }));
    expect(bridge.peerCount("s1")).toBe(1);
  });

  it("fires onForward per peer delivery with the frame size, never for the sender itself", () => {
    const forwards: number[] = [];
    const bridge = new RelaySessionBridge({ onForward: (_s, bytes) => forwards.push(bytes) });
    const a = fakeSocket();
    const b = fakeSocket();
    bridge.attach(a.socket);
    bridge.attach(b.socket);
    a.emit(JSON.stringify({ type: "relay_register", sessionId: "s1" }));
    b.emit(JSON.stringify({ type: "relay_register", sessionId: "s1" }));
    const frame = "x".repeat(123);
    a.emit(frame);
    expect(b.sent).toEqual([frame]);
    expect(forwards).toEqual([123]);
    // A lone socket with no peer delivers nothing and fires no hook.
    b.emitClose();
    a.emit("hello");
    expect(forwards).toEqual([123]);
  });

  it("fires onUnregister with the post-removal peer count", () => {
    const events: Array<{ sessionId: string; peers: number }> = [];
    const bridge = new RelaySessionBridge({
      onUnregister: (_s, sessionId, peers) => events.push({ sessionId, peers }),
    });
    const a = fakeSocket();
    const b = fakeSocket();
    bridge.attach(a.socket);
    bridge.attach(b.socket);
    a.emit(JSON.stringify({ type: "relay_register", sessionId: "s1" }));
    b.emit(JSON.stringify({ type: "relay_register", sessionId: "s1" }));
    a.emitClose();
    b.emitClose();
    expect(events).toEqual([
      { sessionId: "s1", peers: 1 },
      { sessionId: "s1", peers: 0 },
    ]);
  });

  it("never fires onUnregister for a socket that closed before registering", () => {
    let unregistered = 0;
    const bridge = new RelaySessionBridge({ onUnregister: () => unregistered++ });
    const a = fakeSocket();
    bridge.attach(a.socket);
    a.emitClose();
    expect(unregistered).toBe(0);
  });
});
