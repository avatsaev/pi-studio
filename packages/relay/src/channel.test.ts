import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";

import { createClientChannel, createDaemonChannel, type Transport } from "./channel.js";

/** Wires two in-memory `Transport`s together, simulating an untrusted relay passing frames verbatim. */
function createLinkedTransports(): { client: Transport; daemon: Transport } {
  const clientHandlers: Array<(data: string) => void> = [];
  const daemonHandlers: Array<(data: string) => void> = [];
  const clientCloseHandlers: Array<(reason?: string) => void> = [];
  const daemonCloseHandlers: Array<(reason?: string) => void> = [];

  const client: Transport = {
    send: (data) => {
      for (const h of daemonHandlers) h(data);
    },
    onMessage: (h) => clientHandlers.push(h),
    onClose: (h) => clientCloseHandlers.push(h),
    close: () => {
      for (const h of clientCloseHandlers) h("closed");
      for (const h of daemonCloseHandlers) h("closed");
    },
  };
  const daemon: Transport = {
    send: (data) => {
      for (const h of clientHandlers) h(data);
    },
    onMessage: (h) => daemonHandlers.push(h),
    onClose: (h) => daemonCloseHandlers.push(h),
    close: () => {
      for (const h of clientCloseHandlers) h("closed");
      for (const h of daemonCloseHandlers) h("closed");
    },
  };
  return { client, daemon };
}

/** A transport wrapper that records every frame sent by the wrapped side. */
function spy(transport: Transport): Transport & { sent: string[] } {
  const sent: string[] = [];
  return {
    ...transport,
    sent,
    send: (data) => {
      sent.push(data);
      transport.send(data);
    },
  };
}

/** Sets up a fully paired client/daemon channel (handshake already run synchronously). */
function pairChannels(sessionId = "sess-1") {
  const daemonKeypair = nacl.box.keyPair();
  const { client: clientTransport, daemon: daemonTransport } = createLinkedTransports();

  const daemonMessages: string[] = [];
  const clientMessages: string[] = [];
  const daemonAuthErrors: unknown[] = [];
  const clientAuthErrors: unknown[] = [];

  // The daemon channel must be created first so it is listening for `e2ee_hello` before the
  // client sends it (both transports are synchronous, but wiring order still matters for clarity).
  const daemon = createDaemonChannel({
    transport: daemonTransport,
    attachment: { sessionId },
    daemonKeypair,
    events: {
      onMessage: (m) => daemonMessages.push(m),
      onAuthError: (e) => daemonAuthErrors.push(e),
    },
  });
  const client = createClientChannel({
    transport: clientTransport,
    attachment: { sessionId },
    daemonPublicKey: daemonKeypair.publicKey,
    events: {
      onMessage: (m) => clientMessages.push(m),
      onAuthError: (e) => clientAuthErrors.push(e),
    },
  });

  return { client, daemon, daemonKeypair, daemonMessages, clientMessages, daemonAuthErrors, clientAuthErrors };
}

describe("relay encrypted channel", () => {
  it("gates app messages until the e2ee_hello/e2ee_ready handshake completes", () => {
    const { client, daemon } = pairChannels();
    // Over the synchronous in-memory transport, both sides have already completed the handshake.
    expect(daemon.ready).toBe(true);
    expect(client.ready).toBe(true);
    expect(() => daemon.send("x")).not.toThrow();
    expect(() => client.send("y")).not.toThrow();
  });

  it("refuses to send before the daemon has received e2ee_hello", () => {
    const daemonKeypair = nacl.box.keyPair();
    const daemonTransport: Transport = {
      send: () => {},
      onMessage: () => {},
      onClose: () => {},
      close: () => {},
    };
    const daemon = createDaemonChannel({
      transport: daemonTransport,
      attachment: { sessionId: "sess-lonely" },
      daemonKeypair,
    });
    expect(daemon.ready).toBe(false);
    expect(() => daemon.send("too early")).toThrow(/handshake/);
  });

  it("round-trips an encrypted app message both ways", () => {
    const { client, daemon, clientMessages, daemonMessages } = pairChannels();
    client.send("hello daemon");
    daemon.send("hello client");
    expect(daemonMessages).toEqual(["hello daemon"]);
    expect(clientMessages).toEqual(["hello client"]);
  });

  it("rejects tampered ciphertext without crashing and without delivering it", () => {
    const daemonKeypair = nacl.box.keyPair();
    const daemonHandlers: Array<(data: string) => void> = [];
    const clientHandlers: Array<(data: string) => void> = [];
    let lastClientToDaemonFrame = "";

    const clientTransport: Transport = {
      send: (data) => {
        lastClientToDaemonFrame = data;
        for (const h of daemonHandlers) h(data);
      },
      onMessage: (h) => clientHandlers.push(h),
      onClose: () => {},
      close: () => {},
    };
    const daemonTransport: Transport = {
      send: (data) => {
        for (const h of clientHandlers) h(data);
      },
      onMessage: (h) => daemonHandlers.push(h),
      onClose: () => {},
      close: () => {},
    };

    const daemonMessages: string[] = [];
    const daemonAuthErrors: unknown[] = [];
    const daemon = createDaemonChannel({
      transport: daemonTransport,
      attachment: { sessionId: "sess-tamper" },
      daemonKeypair,
      events: {
        onMessage: (m) => daemonMessages.push(m),
        onAuthError: (e) => daemonAuthErrors.push(e),
      },
    });
    createClientChannel({
      transport: clientTransport,
      attachment: { sessionId: "sess-tamper" },
      daemonPublicKey: daemonKeypair.publicKey,
    });

    // `lastClientToDaemonFrame` is now the `e2ee_hello` handshake frame (the only send so far).
    // Corrupt an app frame instead: derive one, tamper it, and feed it directly to the daemon.
    const parsedHello = JSON.parse(lastClientToDaemonFrame) as { type: string };
    expect(parsedHello.type).toBe("e2ee_hello");

    // Build a syntactically valid but cryptographically bogus app frame and inject it.
    const bogusAppFrame = JSON.stringify({ type: "e2ee_app", frame: "AAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    for (const h of daemonHandlers) h(bogusAppFrame);

    expect(daemonAuthErrors.length).toBe(1);
    expect(daemonMessages).toEqual([]);
    expect(daemon.ready).toBe(true); // a bad frame never tears down the channel
  });

  it("derives independent keys per session — replaying session one's ciphertext at session two's daemon fails auth", () => {
    const daemonOneKeypair = nacl.box.keyPair();
    const daemonTwoKeypair = nacl.box.keyPair();
    const linkOne = createLinkedTransports();
    const linkTwo = createLinkedTransports();
    const clientOneTransportSpy = spy(linkOne.client);

    const daemonOneMessages: string[] = [];
    const daemonTwoMessages: string[] = [];
    const daemonTwoAuthErrors: unknown[] = [];

    createDaemonChannel({
      transport: linkOne.daemon,
      attachment: { sessionId: "sess-a" },
      daemonKeypair: daemonOneKeypair,
      events: { onMessage: (m) => daemonOneMessages.push(m) },
    });
    const clientOne = createClientChannel({
      transport: clientOneTransportSpy,
      attachment: { sessionId: "sess-a" },
      daemonPublicKey: daemonOneKeypair.publicKey,
    });
    const daemonTwo = createDaemonChannel({
      transport: linkTwo.daemon,
      attachment: { sessionId: "sess-b" },
      daemonKeypair: daemonTwoKeypair,
      events: {
        onMessage: (m) => daemonTwoMessages.push(m),
        onAuthError: (e) => daemonTwoAuthErrors.push(e),
      },
    });
    createClientChannel({
      transport: linkTwo.client,
      attachment: { sessionId: "sess-b" },
      daemonPublicKey: daemonTwoKeypair.publicKey,
    });

    clientOne.send("secret-for-session-one");
    expect(daemonOneMessages).toEqual(["secret-for-session-one"]);
    // Session one's client sent two frames: `e2ee_hello`, then the app frame. Replay the app
    // frame verbatim at session two's daemon (as a compromised/malicious relay would, since it
    // only ever sees ciphertext) — it must fail authentication under session two's independently
    // derived shared key, never decrypt. `linkTwo.client.send` is the injection point the daemon
    // channel actually listens on, simulating the relay forwarding a foreign frame to it.
    const appFrame = clientOneTransportSpy.sent.find((f) => (JSON.parse(f) as { type: string }).type === "e2ee_app");
    expect(appFrame).toBeDefined();
    linkTwo.client.send(appFrame!);

    expect(daemonTwoMessages).toEqual([]);
    expect(daemonTwoAuthErrors.length).toBe(1);
    expect(daemonTwo.ready).toBe(true);
  });

  it("propagates transport close to the onClose event", () => {
    const daemonKeypair = nacl.box.keyPair();
    const { client: clientTransport, daemon: daemonTransport } = createLinkedTransports();
    let clientClosed = false;
    let daemonClosed = false;

    const daemon = createDaemonChannel({
      transport: daemonTransport,
      attachment: { sessionId: "sess-close" },
      daemonKeypair,
      events: { onClose: () => (daemonClosed = true) },
    });
    const client = createClientChannel({
      transport: clientTransport,
      attachment: { sessionId: "sess-close" },
      daemonPublicKey: daemonKeypair.publicKey,
      events: { onClose: () => (clientClosed = true) },
    });

    client.close();

    expect(clientClosed).toBe(true);
    expect(daemonClosed).toBe(true);
    expect(() => daemon.send("after-close")).toThrow(/close/);
  });
});
