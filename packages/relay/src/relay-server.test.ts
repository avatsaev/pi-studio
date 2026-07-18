import { describe, expect, it, afterEach } from "vitest";
import nacl from "tweetnacl";
import { WebSocket } from "ws";

import { startRelayServer, type RelayServerHandle } from "./relay-server.js";
import { createClientChannel, createDaemonChannel } from "./channel.js";

/**
 * Integration test for the standalone, runnable relay server (as opposed to `session-bridge.test.ts`,
 * which tests the bridging primitive directly). This exercises the actual `ws.WebSocketServer` +
 * HTTP health endpoint that `relay-main.ts` (the `pi-studio-relay` bin) and `pi-studio relay start`
 * (CLI) boot in production.
 */

let handle: RelayServerHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

describe("standalone relay server", () => {
  it("binds the requested host:port and answers GET /health with 200 ok", async () => {
    handle = await startRelayServer({ host: "127.0.0.1", port: 0 });
    expect(handle.port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("404s any other HTTP path", async () => {
    handle = await startRelayServer({ host: "127.0.0.1", port: 0 });
    const res = await fetch(`http://127.0.0.1:${handle.port}/not-a-real-path`);
    expect(res.status).toBe(404);
  });

  it("bridges a real daemon channel and a real client channel end-to-end through actual WebSocket connections", async () => {
    handle = await startRelayServer({ host: "127.0.0.1", port: 0 });
    const sessionId = "sess-integration-1";
    const daemonKeypair = nacl.box.keyPair();

    const daemonSocket = new WebSocket(`ws://127.0.0.1:${handle.port}`);
    await new Promise((resolve, reject) => {
      daemonSocket.once("open", resolve);
      daemonSocket.once("error", reject);
    });
    const daemonMessageHandlers: Array<(data: string) => void> = [];
    daemonSocket.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) for (const h of daemonMessageHandlers) h(data.toString("utf8"));
    });
    const daemonMessages: string[] = [];
    const daemonReady = Promise.withResolvers<void>();
    createDaemonChannel({
      transport: {
        send: (d) => daemonSocket.send(d),
        onMessage: (h) => daemonMessageHandlers.push(h),
        onClose: () => {},
        close: () => daemonSocket.close(),
      },
      attachment: { sessionId },
      daemonKeypair,
      events: { onMessage: (m) => daemonMessages.push(m), onReady: () => daemonReady.resolve() },
    });
    daemonSocket.send(JSON.stringify({ type: "relay_register", sessionId }));

    const clientSocket = new WebSocket(`ws://127.0.0.1:${handle.port}`);
    await new Promise((resolve, reject) => {
      clientSocket.once("open", resolve);
      clientSocket.once("error", reject);
    });
    const clientMessageHandlers: Array<(data: string) => void> = [];
    clientSocket.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) for (const h of clientMessageHandlers) h(data.toString("utf8"));
    });
    const clientReady = Promise.withResolvers<void>();
    clientSocket.send(JSON.stringify({ type: "relay_register", sessionId }));
    const clientChannel = createClientChannel({
      transport: {
        send: (d) => clientSocket.send(d),
        onMessage: (h) => clientMessageHandlers.push(h),
        onClose: () => {},
        close: () => clientSocket.close(),
      },
      attachment: { sessionId },
      daemonPublicKey: daemonKeypair.publicKey,
      events: { onReady: () => clientReady.resolve() },
    });

    await Promise.all([daemonReady.promise, clientReady.promise]);

    clientChannel.send("hello through the real relay server");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(daemonMessages).toEqual(["hello through the real relay server"]);

    daemonSocket.close();
    clientSocket.close();
  });

  it("keeps sessions isolated: a socket registered under one session never receives traffic from another", async () => {
    handle = await startRelayServer({ host: "127.0.0.1", port: 0 });

    const a1 = new WebSocket(`ws://127.0.0.1:${handle.port}`);
    const a2 = new WebSocket(`ws://127.0.0.1:${handle.port}`);
    const b1 = new WebSocket(`ws://127.0.0.1:${handle.port}`);
    await Promise.all(
      [a1, a2, b1].map((s) => new Promise((resolve, reject) => {
        s.once("open", resolve);
        s.once("error", reject);
      })),
    );

    a1.send(JSON.stringify({ type: "relay_register", sessionId: "sess-a" }));
    a2.send(JSON.stringify({ type: "relay_register", sessionId: "sess-a" }));
    b1.send(JSON.stringify({ type: "relay_register", sessionId: "sess-b" }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    const receivedByB1: string[] = [];
    b1.on("message", (data: Buffer) => receivedByB1.push(data.toString("utf8")));

    a1.send("only-for-session-a");
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(receivedByB1).toEqual([]);

    a1.close();
    a2.close();
    b1.close();
  });
});
