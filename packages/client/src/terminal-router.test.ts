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
  /** When `true`, the next (and every subsequent) `connect()` rejects — and, matching real
   * browser WebSocket behavior, also fires `onClose` for the failed attempt (see task-001's
   * double-schedule fix). */
  setShouldFail: (fail: boolean) => void;
} {
  const sentText: string[] = [];
  const sentBinary: Uint8Array[] = [];
  let open = false;
  let connects = 0;
  let shouldFail = false;

  const transport: Transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    get isOpen() {
      return open;
    },
    connect: () => {
      connects += 1;
      if (shouldFail) {
        queueMicrotask(() => transport.onClose?.(1006, "connect failed"));
        return Promise.reject(new Error("connect failed"));
      }
      open = true;
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
    setShouldFail: (fail) => {
      shouldFail = fail;
    },
  };
}

/** Manually-fired timer harness (tests that need control over *when* a scheduled reconnect
 * fires, not just whether one was armed). */
function makeManualTimer(): {
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  calls: { id: number; ms: number }[];
  fire: (id: number) => void;
  pending: () => number[];
} {
  const timers = new Map<number, () => void>();
  const calls: { id: number; ms: number }[] = [];
  let nextId = 1;
  return {
    setTimer: (cb, ms) => {
      const id = nextId++;
      timers.set(id, cb);
      calls.push({ id, ms });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
    calls,
    fire: (id) => {
      const cb = timers.get(id);
      timers.delete(id);
      cb?.();
    },
    pending: () => [...timers.keys()],
  };
}

/** Resolves the next time `manager` reports a successful reconnect — a deterministic signal to
 * await instead of a fixed real-timer delay. */
function onceReconnected(
  manager: ReconnectionManager,
): Promise<{ attempt: number; serverId: string | null }> {
  const { promise, resolve } = Promise.withResolvers<{
    attempt: number;
    serverId: string | null;
  }>();
  const unsubscribe = manager.onReconnected((info) => {
    unsubscribe();
    resolve(info);
  });
  return promise;
}

/** Resolves the next time `manager` reports a failed reconnect attempt. */
function onceReconnectFailed(
  manager: ReconnectionManager,
): Promise<{ error: unknown; attempt: number }> {
  const { promise, resolve } = Promise.withResolvers<{ error: unknown; attempt: number }>();
  const unsubscribe = manager.onReconnectFailed((error, attempt) => {
    unsubscribe();
    resolve({ error, attempt });
  });
  return promise;
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

  describe("reconnectNow()", () => {
    it("does nothing on a manager that was never start()ed", () => {
      const fake = makeFakeTransport();
      const client = makeClient(fake.transport);
      const manager = new ReconnectionManager(client, { initialDelayMs: 10, jitter: 0 });
      manager.reconnectNow();
      expect(fake.connectCount()).toBe(0);
    });

    it("does nothing after stop()", async () => {
      const fake = makeFakeTransport();
      const client = makeClient(fake.transport);
      await client.connect();
      const manager = new ReconnectionManager(client, { initialDelayMs: 10, jitter: 0 });
      manager.start();
      manager.stop();
      fake.drop(); // manager detached — no auto-schedule
      manager.reconnectNow(); // guarded by !active — returns synchronously, nothing to await
      expect(fake.connectCount()).toBe(1); // only the initial connect
    });

    it("does nothing while the daemon is open", async () => {
      const fake = makeFakeTransport();
      const client = makeClient(fake.transport);
      await client.connect();
      const manager = new ReconnectionManager(client, { initialDelayMs: 10, jitter: 0 });
      manager.start();
      manager.reconnectNow();
      expect(fake.connectCount()).toBe(1);
      manager.stop();
    });

    it("cancels a pending backoff timer and performs exactly one connect()", async () => {
      const fake = makeFakeTransport();
      const client = makeClient(fake.transport);
      await client.connect();
      expect(fake.connectCount()).toBe(1);

      const timer = makeManualTimer();
      const clearTimerSpy = vi.fn(timer.clearTimer);
      const manager = new ReconnectionManager(client, {
        initialDelayMs: 500,
        jitter: 0,
        setTimer: timer.setTimer,
        clearTimer: clearTimerSpy,
      });
      manager.start();

      fake.drop(); // closed → arms a pending backoff timer, not fired
      expect(timer.calls).toHaveLength(1);
      const handle = timer.calls[0]!.id;

      const reconnected = onceReconnected(manager);
      manager.reconnectNow();
      expect(clearTimerSpy).toHaveBeenCalledWith(handle);
      await reconnected;

      expect(fake.connectCount()).toBe(2); // exactly one forced reconnect
      expect(timer.pending()).toEqual([]); // reconnect succeeded — nothing rescheduled
      manager.stop();
    });

    it("produces exactly one connect() when two calls race one in-flight attempt", async () => {
      const fake = makeFakeTransport();
      const client = makeClient(fake.transport);
      await client.connect();
      const manager = new ReconnectionManager(client, { initialDelayMs: 10, jitter: 0 });
      manager.start();

      fake.drop();
      const reconnected = onceReconnected(manager);
      manager.reconnectNow();
      manager.reconnectNow(); // the in-flight guard makes this a no-op
      await reconnected;

      expect(fake.connectCount()).toBe(2); // 1 initial + 1 forced reconnect
      manager.stop();
    });

    it("resets the ladder to rung 1 after a reconnectNow() whose connect() rejects", async () => {
      const fake = makeFakeTransport();
      const client = makeClient(fake.transport);
      await client.connect();

      const timer = makeManualTimer();
      const manager = new ReconnectionManager(client, {
        initialDelayMs: 500,
        factor: 2,
        jitter: 0,
        setTimer: timer.setTimer,
        clearTimer: timer.clearTimer,
      });
      manager.start();

      // Climb the ladder to rung 2 via one failed scheduled attempt.
      fake.setShouldFail(true);
      fake.drop();
      expect(timer.calls.at(-1)?.ms).toBe(500);
      const firstFailure = onceReconnectFailed(manager);
      timer.fire(timer.calls.at(-1)!.id);
      await firstFailure;
      expect(manager.attemptCount).toBe(2);
      expect(timer.calls.at(-1)?.ms).toBe(1000);

      // Force a reconnect from rung 2; it also fails.
      const secondFailure = onceReconnectFailed(manager);
      manager.reconnectNow();
      await secondFailure;

      expect(manager.attemptCount).toBe(1); // reset to 0, then scheduleReconnect's 0 → 1
      expect(timer.calls.at(-1)?.ms).toBe(500); // rung-1 delay again, not rung 3
      manager.stop();
    });

    it("a failed attempt whose transport also emits close arms exactly one timer", async () => {
      const fake = makeFakeTransport();
      const client = makeClient(fake.transport);
      await client.connect();

      const timer = makeManualTimer();
      const manager = new ReconnectionManager(client, {
        initialDelayMs: 500,
        factor: 2,
        jitter: 0,
        setTimer: timer.setTimer,
        clearTimer: timer.clearTimer,
      });
      manager.start();

      fake.setShouldFail(true);
      fake.drop();
      expect(timer.calls).toHaveLength(1);
      const failed = onceReconnectFailed(manager);
      timer.fire(timer.calls[0]!.id);
      await failed;

      expect(timer.calls).toHaveLength(2); // exactly one new timer armed, not two
      expect(manager.attemptCount).toBe(2); // incremented exactly once
      expect(timer.pending()).toHaveLength(1); // no leaked second timer handle
      manager.stop();
    });

    it("notifies onReconnected with attempt 0 for a successful forced reconnect", async () => {
      const fake = makeFakeTransport();
      const client = makeClient(fake.transport);
      await client.connect();
      const manager = new ReconnectionManager(client, { initialDelayMs: 10, jitter: 0 });
      const reconnected: number[] = [];
      manager.onReconnected((info) => reconnected.push(info.attempt));
      manager.start();

      fake.drop();
      const done = onceReconnected(manager);
      manager.reconnectNow();
      await done;

      expect(reconnected).toEqual([0]);
      manager.stop();
    });
  });
});
