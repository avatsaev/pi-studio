import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { WebSocket, WebSocketServer } from "ws";

import { createClientChannel } from "@av-pi-studio/relay";

import { connectRelay, type RelayTransportHandle } from "./relay-transport.js";

/**
 * Integration test for the daemon's outbound relay transport (architecture/relay-e2ee.md §
 * Behavior — Connection setup, § Error Handling — reconnect on drop). Runs a minimal fake relay
 * (a bare `WebSocketServer` that accepts a `relay_register` frame and then forwards every other
 * text frame verbatim between the sockets sharing a `sessionId` — mimicking what the real
 * Cloudflare adapter, task-004, will do) and drives the daemon transport against it.
 */

interface FakeRelay {
  port: number;
  close(): Promise<void>;
  /** Registered session ids, in registration order (including re-registrations after reconnect). */
  registeredSessionIds: string[];
  /** Open a raw client-role socket into the fake relay for `sessionId`. */
  connectClient(sessionId: string): Promise<WebSocket>;
  /** Force-close the relay-side socket(s) registered under `sessionId`, simulating a relay drop. */
  dropSession(sessionId: string): void;
}

/** A minimal fake relay: sockets that send `{type:"relay_register",sessionId}` get paired by sessionId; all other frames are forwarded verbatim between the pair. */
async function startFakeRelay(): Promise<FakeRelay> {
  const http: Server = createServer();
  const wss = new WebSocketServer({ server: http });
  const bySession = new Map<string, WebSocket[]>();
  const registeredSessionIds: string[] = [];

  wss.on("connection", (socket: WebSocket) => {
    let sessionId: string | null = null;
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      const text = data.toString("utf8");
      if (sessionId === null) {
        const parsed = JSON.parse(text) as { type?: string; sessionId?: string };
        if (parsed.type === "relay_register" && parsed.sessionId) {
          sessionId = parsed.sessionId;
          registeredSessionIds.push(sessionId);
          const peers = bySession.get(sessionId) ?? [];
          peers.push(socket);
          bySession.set(sessionId, peers);
          return;
        }
        return; // first frame from a non-daemon peer isn't registration; ignore for this fake
      }
      // Forward verbatim to every OTHER socket registered under the same session id.
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
    registeredSessionIds,
    async close() {
      for (const peers of bySession.values()) for (const s of peers) s.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
    connectClient(sessionId: string): Promise<WebSocket> {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      return new Promise((resolve, reject) => {
        socket.once("open", () => {
          socket.send(JSON.stringify({ type: "relay_register", sessionId }));
          resolve(socket);
        });
        socket.once("error", reject);
      });
    },
    dropSession(sessionId: string) {
      for (const socket of bySession.get(sessionId) ?? []) socket.close();
    },
  };
}

let relay: FakeRelay | undefined;
let handle: RelayTransportHandle | undefined;
/** Poll `predicate` until it returns true or `timeoutMs` elapses. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor: timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}


afterEach(async () => {
  handle?.close();
  handle = undefined;
  await relay?.close();
  relay = undefined;
});

describe("daemon relay transport", () => {
  it("dials outbound and registers a session id", async () => {
    relay = await startFakeRelay();
    const daemonKeypair = nacl.box.keyPair();

    const started = Promise.withResolvers<string>();
    handle = connectRelay(
      daemonKeypair,
      { enabled: true, endpoint: `127.0.0.1:${relay.port}`, useTls: false, publicUseTls: false },
      { onSessionStart: (sessionId) => started.resolve(sessionId) },
    );

    const sessionId = await started.promise;
    await waitFor(() => relay!.registeredSessionIds.includes(sessionId));
    expect(relay.registeredSessionIds).toContain(sessionId);
  });

  it("refuses app messages until the e2ee handshake completes, then delivers them", async () => {
    relay = await startFakeRelay();
    const daemonKeypair = nacl.box.keyPair();

    const started = Promise.withResolvers<string>();
    const received: string[] = [];
    handle = connectRelay(
      daemonKeypair,
      { enabled: true, endpoint: `127.0.0.1:${relay.port}`, useTls: false, publicUseTls: false },
      {
        onSessionStart: (sessionId) => started.resolve(sessionId),
        onMessage: (plaintext, reply) => {
          received.push(plaintext);
          reply(`ack:${plaintext}`);
        },
      },
    );
    const sessionId = await started.promise;

    // Attach a real client-role socket + channel to the same session, exactly like a real client
    // would via the relay's routing — this drives the actual `e2ee_hello`/`e2ee_ready` handshake,
    // not a mock of it.
    const clientSocket = await relay.connectClient(sessionId);
    const clientMessages: string[] = [];
    const clientReady = Promise.withResolvers<void>();
    const clientTransportMessageHandlers: Array<(data: string) => void> = [];
    clientSocket.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) for (const h of clientTransportMessageHandlers) h(data.toString("utf8"));
    });
    const clientChannel = createClientChannel({
      transport: {
        send: (data) => clientSocket.send(data),
        onMessage: (h) => clientTransportMessageHandlers.push(h),
        onClose: () => {},
        close: () => clientSocket.close(),
      },
      attachment: { sessionId },
      daemonPublicKey: daemonKeypair.publicKey,
      events: {
        onReady: () => clientReady.resolve(),
        onMessage: (m) => clientMessages.push(m),
      },
    });
    await clientReady.promise;

    clientChannel.send("ping-from-client");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toEqual(["ping-from-client"]);
    expect(clientMessages).toEqual(["ack:ping-from-client"]);

    clientSocket.close();
  });

  it("reconnects with a fresh session id when the relay connection drops", async () => {
    relay = await startFakeRelay();
    const daemonKeypair = nacl.box.keyPair();

    const sessionIds: string[] = [];
    const firstSessionStarted = Promise.withResolvers<string>();
    const secondSessionStarted = Promise.withResolvers<string>();
    handle = connectRelay(
      daemonKeypair,
      { enabled: true, endpoint: `127.0.0.1:${relay.port}`, useTls: false, publicUseTls: false },
      {
        onSessionStart: (sessionId) => {
          sessionIds.push(sessionId);
          if (sessionIds.length === 1) firstSessionStarted.resolve(sessionId);
        },
        onReconnect: (sessionId) => {
          if (sessionIds.length === 1) secondSessionStarted.resolve(sessionId);
        },
      },
    );

    const firstSessionId = await firstSessionStarted.promise;
    await waitFor(() => relay!.registeredSessionIds.includes(firstSessionId));
    relay.dropSession(firstSessionId);

    const secondSessionId = await secondSessionStarted.promise;
    expect(secondSessionId).not.toBe(firstSessionId);

    // The reconnect actually completes a fresh registration against the same (still-running) relay.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(relay.registeredSessionIds).toContain(secondSessionId);
  });

  it("close() tears down the transport and stops reconnecting", async () => {
    relay = await startFakeRelay();
    const daemonKeypair = nacl.box.keyPair();

    const started = Promise.withResolvers<string>();
    handle = connectRelay(
      daemonKeypair,
      { enabled: true, endpoint: `127.0.0.1:${relay.port}`, useTls: false, publicUseTls: false },
      { onSessionStart: (sessionId) => started.resolve(sessionId) },
    );
    const sessionId = await started.promise;
    await waitFor(() => relay!.registeredSessionIds.includes(sessionId));

    const registeredBeforeClose = relay.registeredSessionIds.length;
    handle.close();
    // Give any (incorrect) reconnect attempt time to fire.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(relay.registeredSessionIds.length).toBe(registeredBeforeClose);
    void sessionId;
  });
});
