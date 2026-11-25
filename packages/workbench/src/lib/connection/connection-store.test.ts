import {
  DEFAULT_RPC_TIMEOUT_MS,
  RelayConnectError,
  RpcTimeoutError,
  type Transport,
} from "@av-pi-studio/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHost, resetHostForTests } from "../../host/install.js";
import { createTestHost } from "../../test/test-host.js";
import { useConnectionStore } from "./connection-store.js";

function failingTransport(error: Error): Transport {
  return {
    isOpen: false,
    onMessage: null,
    onClose: null,
    onError: null,
    connect: async () => {
      throw error;
    },
    sendText: () => {},
    sendBinary: () => {},
    close: () => {},
  };
}

beforeEach(() => {
  resetHostForTests();
  useConnectionStore.getState().disconnect();
  useConnectionStore.setState({ error: null, errorReason: null });
});

afterEach(() => {
  useConnectionStore.getState().disconnect();
});

describe("the connection store's failure reason", () => {
  it("keeps wrong_key readable beside the message", async () => {
    const failure = new RelayConnectError("wrong_key");
    installHost(createTestHost({ createTransport: () => failingTransport(failure) }));

    await expect(useConnectionStore.getState().connect({ url: "box:6767" })).rejects.toThrow();

    expect(useConnectionStore.getState().errorReason).toBe("wrong_key");
    expect(useConnectionStore.getState().error).toBe(failure.message);
  });

  it("leaves the reason empty for another error, and clears it on the next attempt", async () => {
    useConnectionStore.setState({ error: "old", errorReason: "wrong_key" });
    installHost(
      createTestHost({ createTransport: () => failingTransport(new Error("refused by test")) }),
    );

    const attempt = useConnectionStore.getState().connect({ url: "box:6767" });
    expect(useConnectionStore.getState().errorReason).toBeNull();
    await expect(attempt).rejects.toThrow();

    expect(useConnectionStore.getState().errorReason).toBeNull();
    expect(useConnectionStore.getState().error).not.toBeNull();
  });

  it("keeps the reason when the transport factory throws a relay error", async () => {
    installHost(
      createTestHost({
        createTransport: () => {
          throw new RelayConnectError("daemon_offline");
        },
      }),
    );

    await expect(useConnectionStore.getState().connect({ url: "box:6767" })).rejects.toThrow();

    expect(useConnectionStore.getState().errorReason).toBe("daemon_offline");
  });
});

/**
 * Answers `hello` with a `server_info`. Its close reaches the client only when the test says so
 * (`arrive`), as a real socket's does after `close()` returned.
 */
function lateClosingTransport(): { transport: Transport; arrive(): void } {
  let closedWith: [number, string] | null = null;
  const transport: Transport = {
    isOpen: true,
    onMessage: null,
    onClose: null,
    onError: null,
    connect: async () => {},
    sendText: () => {
      const info = { status: "server_info", serverId: "s1", features: {}, capabilities: {} };
      queueMicrotask(() =>
        transport.onMessage?.(JSON.stringify({ type: "status", payload: info })),
      );
    },
    sendBinary: () => {},
    close: (code = 1000, reason = "") => {
      closedWith = [code, reason];
    },
  };
  return { transport, arrive: () => closedWith && transport.onClose?.(...closedWith) };
}

describe("a manual disconnect", () => {
  it("stays idle when the transport's close arrives afterwards", async () => {
    const late = lateClosingTransport();
    installHost(createTestHost({ createTransport: () => late.transport }));
    await useConnectionStore.getState().connect({ url: "box:6767" });
    expect(useConnectionStore.getState().status).toBe("open");

    useConnectionStore.getState().disconnect();
    late.arrive();

    expect(useConnectionStore.getState().status).toBe("idle");
  });
});

/** Answers `hello` with a `server_info` and every later request with nothing at all. */
function silentDaemonTransport(): Transport {
  const transport: Transport = {
    isOpen: true,
    onMessage: null,
    onClose: null,
    onError: null,
    connect: async () => {},
    sendText: (data) => {
      if (!data.includes('"hello"')) return;
      const info = { status: "server_info", serverId: "s1", features: {}, capabilities: {} };
      queueMicrotask(() =>
        transport.onMessage?.(JSON.stringify({ type: "status", payload: info })),
      );
    },
    sendBinary: () => {},
    close: () => {},
  };
  return transport;
}

describe("the connection's request timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is the SDK default: a daemon that never answers fails the request after 30 s and the socket stays up", async () => {
    vi.useFakeTimers();
    installHost(createTestHost({ createTransport: () => silentDaemonTransport() }));
    await useConnectionStore.getState().connect({ url: "box:6767" });
    const { daemon } = useConnectionStore.getState();
    if (!daemon) throw new Error("connect left no daemon");

    let settled = false;
    const outcome = daemon.request("list_agents_request", {}).then(
      () => {
        settled = true;
        return null;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_RPC_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toBeInstanceOf(RpcTimeoutError);
    expect(useConnectionStore.getState().status).toBe("open");
  });
});
