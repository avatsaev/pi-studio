import { describe, expect, it, vi } from "vitest";

import { encodeTerminalFrame } from "@av-pi-studio/protocol";

import { DaemonClient, RpcError, RpcTimeoutError } from "./daemon-client.js";
import type { Transport } from "./transport.js";

/**
 * In-memory transport with a scripted "daemon" on the other end. Captures everything the client
 * sends and lets the test push frames back to the client.
 */
function makeFakeTransport(): {
  transport: Transport;
  sent: string[];
  sentBinary: Uint8Array[];
  push: (data: string | ArrayBuffer) => void;
  drop: (code?: number, reason?: string) => void;
} {
  const sent: string[] = [];
  const sentBinary: Uint8Array[] = [];
  let open = false;

  const transport: Transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    get isOpen() {
      return open;
    },
    connect: () => {
      open = true;
      return Promise.resolve();
    },
    sendText: (data) => {
      sent.push(data);
      // Auto-reply to the hello handshake like a real daemon (unless suppressed).
      try {
        const parsed = JSON.parse(data) as { type?: string };
        if (parsed.type === "hello") {
          queueMicrotask(() => transport.onMessage?.(serverInfoFrame()));
        }
      } catch {
        /* ignore */
      }
    },
    sendBinary: (data) => {
      sentBinary.push(data);
    },
    close: (code = 1000, reason = "") => {
      open = false;
      transport.onClose?.(code, reason);
    },
  };

  return {
    transport,
    sent,
    sentBinary,
    push: (data) => transport.onMessage?.(data),
    drop: (code = 1006, reason = "lost") => {
      open = false;
      transport.onClose?.(code, reason);
    },
  };
}

function serverInfoFrame(): string {
  return JSON.stringify({
    type: "status",
    payload: {
      status: "server_info",
      serverId: "srv-1",
      version: "1.2.3",
      capabilities: { reasoning_merge_enum: true },
      features: { providersSnapshot: true, rewind: false },
    },
  });
}

function makeClient(transport: Transport, rpcTimeoutMs = 50): DaemonClient {
  return new DaemonClient({
    url: "ws://daemon.test/ws",
    clientId: "client-1",
    clientType: "cli",
    transport,
    rpcTimeoutMs,
    now: () => 1000,
  });
}

describe("connect / handshake", () => {
  it("sends hello and records serverId + features from server_info", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    const states: string[] = [];
    client.onStateChange((s) => states.push(s));

    const info = await client.connect();

    // The hello frame should have been sent.
    expect(fake.sent).toHaveLength(1);
    const hello = JSON.parse(fake.sent[0]!);
    expect(hello).toMatchObject({ type: "hello", clientId: "client-1", clientType: "cli" });
    expect(hello.protocolVersion).toBeGreaterThanOrEqual(1);

    expect(info.serverId).toBe("srv-1");
    expect(client.serverId).toBe("srv-1");
    expect(client.features.providersSnapshot).toBe(true);
    expect(client.hasFeature("providersSnapshot")).toBe(true);
    expect(client.hasFeature("rewind")).toBe(false);
    expect(client.state).toBe("open");
    expect(states).toEqual(["connecting", "open"]);
  });
});

describe("RPC correlation", () => {
  it("resolves an RPC on its correlated response payload", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();

    const rpc = client.request("create_agent_request", { config: { provider: "mock" } });
    // Grab the requestId the client generated.
    const sent = JSON.parse(fake.sent.at(-1)!);
    const requestId = sent.message.requestId as string;
    expect(sent.message.type).toBe("create_agent_request");

    // Daemon responds with the same requestId.
    fake.push(
      JSON.stringify({
        type: "session",
        message: { type: "create_agent_response", requestId, payload: { agentId: "a-1" } },
      }),
    );
    await expect(rpc).resolves.toMatchObject({ agentId: "a-1" });
  });

  it("rejects with RpcError on a correlated rpc_error (same requestId)", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();

    const rpc = client.request("create_agent_request", {});
    const requestId = JSON.parse(fake.sent.at(-1)!).message.requestId as string;
    fake.push(
      JSON.stringify({
        type: "session",
        message: { type: "rpc_error", requestId, message: "boom", code: "E_FAIL" },
      }),
    );
    await expect(rpc).rejects.toBeInstanceOf(RpcError);
    await rpc.catch((e: RpcError) => {
      expect(e.requestId).toBe(requestId);
      expect(e.code).toBe("E_FAIL");
    });
  });
});

describe("RPC timeout (operation error, not socket death)", () => {
  it("rejects with RpcTimeoutError and keeps the socket open", async () => {
    vi.useFakeTimers();
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport, 20);
    await client.connect();

    const rpc = client.request("slow_request", {});
    // Attach the rejection handler BEFORE advancing timers to avoid an unhandled rejection.
    const assertion = expect(rpc).rejects.toBeInstanceOf(RpcTimeoutError);
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    // Socket is still open — state unchanged, transport still writeable.
    expect(client.state).toBe("open");
    expect(fake.transport.isOpen).toBe(true);
    vi.useRealTimers();
  });
});

describe("ping / pong", () => {
  it("resolves ping on the correlated pong", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();

    const pingPromise = client.ping();
    const pingFrame = JSON.parse(fake.sent.at(-1)!);
    expect(pingFrame.type).toBe("ping");
    fake.push(
      JSON.stringify({
        type: "pong",
        requestId: pingFrame.requestId,
        serverReceivedAt: 1,
        serverSentAt: 2,
      }),
    );
    await expect(pingPromise).resolves.toBeUndefined();
  });
});

describe("terminal binary frames", () => {
  it("decodes inbound binary frames and dispatches to terminal handlers", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();

    const frames: unknown[] = [];
    client.onTerminalFrame((f) => frames.push(f));

    const encoded = encodeTerminalFrame({
      opcode: "Output",
      slot: 3,
      data: new TextEncoder().encode("hi"),
    });
    fake.push(
      encoded.buffer.slice(
        encoded.byteOffset,
        encoded.byteOffset + encoded.byteLength,
      ) as ArrayBuffer,
    );

    expect(frames).toHaveLength(1);
    expect((frames[0] as Record<string, unknown>).slot).toBe(3);
  });
});

describe("connection state", () => {
  it("transitions connecting → open → closed on drop", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    const states: string[] = [];
    client.onStateChange((s) => states.push(s));
    await client.connect();
    fake.drop();
    expect(states).toEqual(["connecting", "open", "closed"]);
  });

  it("rejects pending RPCs when the socket drops (distinct from timeout)", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport, 0);
    await client.connect();
    const rpc = client.request("create_agent_request", {});
    fake.drop(1006, "lost");
    await expect(rpc).rejects.toThrow(/socket closed/);
  });
});
