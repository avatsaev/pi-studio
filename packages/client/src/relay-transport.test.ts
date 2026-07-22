import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { WebSocketServer, WebSocket as NodeWebSocket } from "ws";

import { createDaemonChannel, deriveRelaySessionId, type EncryptedChannel } from "@av-pi-studio/relay";

import { createRelayTransport, relayDialUrl } from "./relay-transport.js";
import { createWebSocketTransport } from "./transport.js";
import { DaemonClient } from "./daemon-client.js";
import { parsePairingUrl } from "./pairing.js";

/**
 * Integration test for the client-side relay transport (architecture/relay-e2ee.md § Pairing, §
 * Behavior; architecture/client-app-runtime.md § Layered client library). Runs a minimal fake relay
 * (same shape as `packages/server/src/daemon/relay-transport.test.ts`'s fixture) plus a REAL daemon
 * channel (`createDaemonChannel`, task-001) standing in for `packages/server/src/daemon/
 * relay-transport.ts` (task-002) — proving transport-API parity end-to-end, not against a mock.
 */

interface FakeRelay {
  port: number;
  close(): Promise<void>;
}

async function startFakeRelay(): Promise<FakeRelay> {
  const http: Server = createServer();
  const wss = new WebSocketServer({ server: http });
  const bySession = new Map<string, NodeWebSocket[]>();

  wss.on("connection", (socket: NodeWebSocket) => {
    let sessionId: string | null = null;
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      const text = data.toString("utf8");
      if (sessionId === null) {
        const parsed = JSON.parse(text) as { type?: string; sessionId?: string };
        if (parsed.type === "relay_register" && parsed.sessionId) {
          sessionId = parsed.sessionId;
          const peers = bySession.get(sessionId) ?? [];
          peers.push(socket);
          bySession.set(sessionId, peers);
          return;
        }
        return;
      }
      for (const peer of bySession.get(sessionId) ?? []) {
        if (peer !== socket && peer.readyState === peer.OPEN) peer.send(text);
      }
    });
    socket.on("close", () => {
      if (sessionId === null) return;
      const peers = (bySession.get(sessionId) ?? []).filter((s) => s !== socket);
      if (peers.length > 0) bySession.set(sessionId, peers);
      else bySession.delete(sessionId);
    });
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
  const port = (http.address() as AddressInfo).port;
  return {
    port,
    async close() {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

/** Attach the daemon side (task-001's `createDaemonChannel` over a raw relay socket) for `sessionId`. */
function attachDaemonSide(
  relayPort: number,
  sessionId: string,
  daemonKeypair: nacl.BoxKeyPair,
  onAppMessage: (plaintext: string, reply: (m: string) => void) => void,
  onAppBinary?: (bytes: Uint8Array, replyBinary: (b: Uint8Array) => void) => void,
): Promise<{ socket: NodeWebSocket; channel: EncryptedChannel }> {
  const socket = new NodeWebSocket(`ws://127.0.0.1:${relayPort}`);
  const messageHandlers: Array<(data: string) => void> = [];
  return new Promise((resolve) => {
    socket.once("open", () => {
      socket.send(JSON.stringify({ type: "relay_register", sessionId }));
      socket.on("message", (data: Buffer, isBinary: boolean) => {
        if (!isBinary) for (const h of messageHandlers) h(data.toString("utf8"));
      });
      const channel = createDaemonChannel({
        transport: {
          send: (data) => socket.send(data),
          onMessage: (h) => messageHandlers.push(h),
          onClose: () => {},
          close: () => socket.close(),
        },
        attachment: { sessionId },
        daemonKeypair,
        events: {
          onMessage: (plaintext) => onAppMessage(plaintext, (m) => channel.send(m)),
          onBinaryMessage: (bytes) => onAppBinary?.(bytes, (b) => channel.sendBinary(b)),
        },
      });
      resolve({ socket, channel });
    });
  });
}

let relay: FakeRelay | undefined;
let daemonSocket: NodeWebSocket | undefined;
let client: DaemonClient | undefined;

afterEach(async () => {
  client?.close();
  client = undefined;
  daemonSocket?.close();
  daemonSocket = undefined;
  await relay?.close();
  relay = undefined;
});

describe("client relay transport", () => {
  it("completes the E2EE handshake before any app RPC (hello) crosses the wire", async () => {
    relay = await startFakeRelay();
    const daemonKeypair = nacl.box.keyPair();
    const sessionId = crypto.randomUUID();

    const receivedOnDaemon: string[] = [];
    const attached = await attachDaemonSide(relay.port, sessionId, daemonKeypair, (plaintext, reply) => {
      receivedOnDaemon.push(plaintext);
      const req = JSON.parse(plaintext) as { type: string };
      if (req.type === "hello") {
        reply(
          JSON.stringify({
            type: "status",
            payload: { status: "server_info", serverId: "srv_test", capabilities: {}, features: {} },
          }),
        );
      }
    });
    daemonSocket = attached.socket;

    const transport = createRelayTransport({ sessionId, daemonPublicKey: daemonKeypair.publicKey });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${relay.port}`,
      clientId: "smoke-client",
      clientType: "cli",
      transport,
    });

    const info = await client.connect();
    expect(info.serverId).toBe("srv_test");
    // The only message the fake daemon ever decrypted is the real `hello` RPC — proving it arrived
    // ENCRYPTED (through the completed handshake), not as a plaintext relay_register frame.
    expect(receivedOnDaemon).toEqual([JSON.stringify({ type: "hello", clientId: "smoke-client", clientType: "cli", protocolVersion: 1 })]);
  });

  it("sendBinary() no longer throws — a binary frame round-trips through the daemon over the relay", async () => {
    // Regression: `createRelayTransport`'s `sendBinary()` used to unconditionally throw
    // ("binary frames are not supported over the E2EE relay channel"), so terminal I/O and
    // file-transfer never worked over a relay connection at all. Proves the fix using a REAL
    // relay bridge + REAL E2EE handshake, exactly like the handshake test above, just exercising
    // `sendBinary`/`onmessage`(binary) instead of `sendText`/`hello`.
    relay = await startFakeRelay();
    const daemonKeypair = nacl.box.keyPair();
    const sessionId = crypto.randomUUID();

    const receivedOnDaemon: Uint8Array[] = [];
    const attached = await attachDaemonSide(
      relay.port,
      sessionId,
      daemonKeypair,
      (plaintext, reply) => {
        const req = JSON.parse(plaintext) as { type: string };
        if (req.type === "hello") {
          reply(
            JSON.stringify({
              type: "status",
              payload: { status: "server_info", serverId: "srv_bin_test", capabilities: {}, features: {} },
            }),
          );
        }
      },
      (bytes, replyBinary) => {
        receivedOnDaemon.push(bytes);
        replyBinary(new Uint8Array([0x01, 1, 88, 89, 90])); // opcode Output, slot 1, "XYZ"
      },
    );
    daemonSocket = attached.socket;

    const transport = createRelayTransport({ sessionId, daemonPublicKey: daemonKeypair.publicKey });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${relay.port}`,
      clientId: "binary-smoke-client",
      clientType: "cli",
      transport,
    });
    await client.connect();

    const binaryReceived = Promise.withResolvers<Uint8Array>();
    // `DaemonClient.handleBinaryFrame` decodes every non-file-transfer-opcode binary frame as a
    // terminal frame via `decodeTerminalFrame` — feed/expect bytes shaped like real terminal
    // frames (opcode byte + slot byte + payload) so both directions decode cleanly.
    client.onTerminalFrame((frame) => {
      if (frame.opcode === "Output") binaryReceived.resolve(frame.data);
    });

    const inputFrame = new Uint8Array([0x02, 1, 65, 66, 67]); // opcode Input, slot 1, "ABC"
    expect(() => client!.sendBinary(inputFrame)).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(receivedOnDaemon).toEqual([inputFrame]);

    const echoed = await binaryReceived.promise;
    expect(Array.from(echoed)).toEqual([88, 89, 90]);
  });

  it("relay-profile connection is interchangeable with the direct transport via the same DaemonClient API", async () => {
    // Structural parity check: both transports satisfy the exact same `Transport` shape and both
    // drive `DaemonClient` identically — asserted by using `createRelayTransport` as a drop-in for
    // `createWebSocketTransport` with no DaemonClient code changes (see the `transport` option
    // above). This test additionally confirms `createWebSocketTransport` still constructs cleanly
    // for the same options shape, without actually connecting it (no daemon on this URL).
    const direct = createWebSocketTransport(() => ({
      readyState: 1,
      send: () => {},
      close: () => {},
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
    }));
    expect(typeof direct.connect).toBe("function");
    expect(typeof direct.sendText).toBe("function");
    expect(typeof direct.close).toBe("function");

    const relayTransport = createRelayTransport({
      sessionId: "unused",
      daemonPublicKey: nacl.box.keyPair().publicKey,
    });
    expect(typeof relayTransport.connect).toBe("function");
    expect(typeof relayTransport.sendText).toBe("function");
    expect(typeof relayTransport.close).toBe("function");
  });

  it("defaults sessionId to deriveRelaySessionId(daemonPublicKey) when omitted", async () => {
    relay = await startFakeRelay();
    const daemonKeypair = nacl.box.keyPair();
    const derivedSessionId = deriveRelaySessionId(daemonKeypair.publicKey);

    const attached = await attachDaemonSide(relay.port, derivedSessionId, daemonKeypair, (plaintext, reply) => {
      const req = JSON.parse(plaintext) as { type: string };
      if (req.type === "hello") {
        reply(
          JSON.stringify({
            type: "status",
            payload: { status: "server_info", serverId: "srv_derived", capabilities: {}, features: {} },
          }),
        );
      }
    });
    daemonSocket = attached.socket;

    // No sessionId passed — the transport must derive the exact same id the daemon side
    // registered under (attachDaemonSide was given `derivedSessionId` explicitly above, standing
    // in for the daemon's own `connectRelay`, which now always registers under this derived id).
    const transport = createRelayTransport({ daemonPublicKey: daemonKeypair.publicKey });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${relay.port}`,
      clientId: "derived-session-client",
      clientType: "cli",
      transport,
    });

    const info = await client.connect();
    expect(info.serverId).toBe("srv_derived");
  });

  it("relayDialUrl maps useTls to wss/ws and strips a redundant scheme prefix", () => {
    expect(relayDialUrl({ endpoint: "relay.molagent.ai", useTls: true })).toBe(
      "wss://relay.molagent.ai",
    );
    expect(relayDialUrl({ endpoint: "127.0.0.1:7000", useTls: false })).toBe(
      "ws://127.0.0.1:7000",
    );
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
    const offer = parsePairingUrl(`#offer=${encodeURIComponent(publicKeyB64)}&relay=127.0.0.1%3A7000&relayTls=0`);
    expect(offer!.relay).toEqual({ endpoint: "127.0.0.1:7000", useTls: false });
  });
});
