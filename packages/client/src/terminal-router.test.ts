import { describe, expect, it, vi } from "vitest";

import { decodeTerminalFrame, encodeTerminalFrame } from "@av-pi-studio/protocol";

import { DaemonClient } from "./daemon-client.js";
import { ReconnectionManager } from "./reconnect.js";
import { TerminalStreamRouter } from "./terminal-stream-router.js";
import type { Transport } from "./transport.js";

// ─── Reconnectable fake transport ──────────────────────────────────────────────

function makeFakeTransport(): {
  transport: Transport;
  sentText: string[];
  sentBinary: Uint8Array[];
  pushBinary: (bytes: Uint8Array) => void;
  drop: () => void;
  connectCount: () => number;
} {
  const sentText: string[] = [];
  const sentBinary: Uint8Array[] = [];
  let open = false;
  let connects = 0;

  const transport: Transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    get isOpen() {
      return open;
    },
    connect: () => {
      open = true;
      connects += 1;
      return Promise.resolve();
    },
    sendText: (data) => {
      sentText.push(data);
      const parsed = JSON.parse(data) as { type?: string };
      if (parsed.type === "hello") {
        queueMicrotask(() =>
          transport.onMessage?.(
            JSON.stringify({
              type: "status",
              payload: {
                status: "server_info",
                serverId: "srv-1",
                capabilities: { terminal_reflowable_snapshot: true },
                features: { "terminal-restore-modes": true },
              },
            }),
          ),
        );
      }
    },
    sendBinary: (data) => {
      sentBinary.push(data);
    },
    close: () => {
      open = false;
      transport.onClose?.(1000, "");
    },
  };

  return {
    transport,
    sentText,
    sentBinary,
    pushBinary: (bytes) =>
      transport.onMessage?.(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      ),
    drop: () => {
      open = false;
      transport.onClose?.(1006, "lost");
    },
    connectCount: () => connects,
  };
}

function makeClient(transport: Transport): DaemonClient {
  return new DaemonClient({
    url: "ws://t/ws",
    clientId: "c1",
    clientType: "cli",
    transport,
    capabilities: { terminal_reflowable_snapshot: true },
    rpcTimeoutMs: 0,
  });
}

// ─── Terminal router ────────────────────────────────────────────────────────────

describe("TerminalStreamRouter — inbound demux", () => {
  it("delivers Output and Snapshot frames to the correct slot subscriber", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const router = new TerminalStreamRouter(client);
    router.start();

    const slot3: string[] = [];
    const slot7: string[] = [];
    router.subscribeSlot(3, {
      onOutput: (d) => slot3.push(`out:${new TextDecoder().decode(d)}`),
      onSnapshot: (d) => slot3.push(`snap:${new TextDecoder().decode(d)}`),
    });
    router.subscribeSlot(7, {
      onOutput: (d) => slot7.push(`out:${new TextDecoder().decode(d)}`),
    });

    fake.pushBinary(
      encodeTerminalFrame({
        opcode: "Snapshot",
        slot: 3,
        data: new TextEncoder().encode("screen"),
      }),
    );
    fake.pushBinary(
      encodeTerminalFrame({ opcode: "Output", slot: 3, data: new TextEncoder().encode("abc") }),
    );
    fake.pushBinary(
      encodeTerminalFrame({ opcode: "Output", slot: 7, data: new TextEncoder().encode("xyz") }),
    );

    expect(slot3).toEqual(["snap:screen", "out:abc"]);
    expect(slot7).toEqual(["out:xyz"]);
  });

  it("drops frames for slots with no subscriber", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const router = new TerminalStreamRouter(client);
    router.start();
    // No throw, nothing delivered.
    expect(() =>
      fake.pushBinary(
        encodeTerminalFrame({ opcode: "Output", slot: 99, data: new Uint8Array([1]) }),
      ),
    ).not.toThrow();
  });
});

describe("TerminalStreamRouter — outbound encoding", () => {
  it("encodes Input with opcode 0x02 + slot", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const router = new TerminalStreamRouter(client);

    router.sendInput(5, new TextEncoder().encode("ls\n"));
    expect(fake.sentBinary).toHaveLength(1);
    const decoded = decodeTerminalFrame(fake.sentBinary[0]!);
    expect(decoded.opcode).toBe("Input");
    expect(decoded.slot).toBe(5);
  });

  it("encodes Resize with opcode 0x03 + slot and {rows,cols}", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const router = new TerminalStreamRouter(client);

    router.sendResize(2, 24, 80);
    const decoded = decodeTerminalFrame(fake.sentBinary[0]!);
    expect(decoded.opcode).toBe("Resize");
    expect(decoded.slot).toBe(2);
    if (decoded.opcode === "Resize") {
      expect(decoded.rows).toBe(24);
      expect(decoded.cols).toBe(80);
    }
  });
});

// ─── Reconnection ─────────────────────────────────────────────────────────────

describe("ReconnectionManager", () => {
  it("re-handshakes and rehydrates capabilities after a drop", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    expect(fake.connectCount()).toBe(1);

    const reconnected: number[] = [];
    const manager = new ReconnectionManager(client, {
      initialDelayMs: 10,
      jitter: 0,
      setTimer: (cb) => {
        // Run immediately for the test.
        queueMicrotask(cb);
        return 1;
      },
    });
    manager.onReconnected((info) => reconnected.push(info.attempt));
    manager.start();

    // Simulate a socket drop → triggers scheduleReconnect → tryReconnect.
    fake.drop();
    await new Promise((r) => setTimeout(r, 5));

    expect(fake.connectCount()).toBe(2); // reconnected
    expect(client.state).toBe("open");
    expect(client.serverId).toBe("srv-1");
    expect(client.serverCapabilities.terminal_reflowable_snapshot).toBe(true);
    // The re-sent hello carried the same capabilities.
    const hellos = fake.sentText.filter((t) => JSON.parse(t).type === "hello");
    expect(hellos.length).toBe(2);
    expect(JSON.parse(hellos[1]!).capabilities).toMatchObject({
      terminal_reflowable_snapshot: true,
    });
    expect(reconnected).toContain(1);

    manager.stop();
  });

  it("computes exponential backoff with cap", () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    const manager = new ReconnectionManager(client, {
      initialDelayMs: 100,
      factor: 2,
      maxDelayMs: 1000,
      jitter: 0,
    });
    expect(manager.delayForAttempt(1)).toBe(100);
    expect(manager.delayForAttempt(2)).toBe(200);
    expect(manager.delayForAttempt(3)).toBe(400);
    expect(manager.delayForAttempt(10)).toBe(1000); // capped
  });

  it("stops scheduling reconnects after stop()", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const setTimerSpy = vi.fn(() => 1);
    const manager = new ReconnectionManager(client, { setTimer: setTimerSpy });
    manager.start();
    manager.stop();
    fake.drop();
    await new Promise((r) => setTimeout(r, 5));
    expect(setTimerSpy).not.toHaveBeenCalled();
  });
});
