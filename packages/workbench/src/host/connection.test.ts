import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Transport } from "@av-pi-studio/client";
import { installHost, resetHostForTests } from "./install.js";
import { useConnectionStore } from "../lib/connection/connection-store.js";
import { createResumeHandler } from "../lib/connection/resume-handler.js";
import { createTestHost } from "../test/test-host.js";

/** A transport that fails to open, so `connect()` settles without a network. */
function refusingTransport(): Transport & { dialed: string[] } {
  const dialed: string[] = [];
  return {
    dialed,
    isOpen: false,
    onMessage: null,
    onClose: null,
    onError: null,
    connect: async (url) => {
      dialed.push(url);
      throw new Error("refused by test transport");
    },
    sendText: () => {},
    sendBinary: () => {},
    close: () => {},
  };
}

beforeEach(() => {
  resetHostForTests();
  useConnectionStore.getState().disconnect();
  useConnectionStore.setState({ error: null });
});

afterEach(() => {
  useConnectionStore.getState().disconnect();
});

describe("connection through the host", () => {
  it("dials through the transport the host returns, with the password", async () => {
    const transport = refusingTransport();
    const host = createTestHost({ createTransport: () => transport });
    installHost(host);

    await expect(
      useConnectionStore.getState().connect({ url: "127.0.0.1:6767", password: "pw" }),
    ).rejects.toThrow();

    expect(host.calls.find((c) => c.member === "connection.createTransport")?.args).toEqual([
      { mode: "direct", url: "ws://127.0.0.1:6767" },
      { password: "pw" },
    ]);
    expect(transport.dialed).toEqual(["ws://127.0.0.1:6767"]);
  });

  it("surfaces a throwing transport factory as the connection error", async () => {
    installHost(
      createTestHost({
        createTransport: () => {
          throw new Error("no native socket");
        },
      }),
    );

    await expect(useConnectionStore.getState().connect({ url: "127.0.0.1:6767" })).rejects.toThrow(
      "no native socket",
    );
    expect(useConnectionStore.getState().error).toBe("no native socket");
  });
});

describe("resume signal", () => {
  it("reconnects at once when the socket is closed and the manager is active", () => {
    const host = createTestHost();
    installHost(host);
    const reconnectNow = vi.fn();
    useConnectionStore.setState({
      status: "closed",
      reconnection: { reconnectNow } as never,
      daemon: null,
    });
    const unsubscribe = host.connection.onResume(createResumeHandler());

    host.emitResume();

    expect(reconnectNow).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(host.resumeListenerCount()).toBe(0);
    useConnectionStore.setState({ reconnection: null });
  });

  it("probes an open socket and closes it when the probe fails", async () => {
    const host = createTestHost();
    installHost(host);
    const close = vi.fn();
    const daemon = { ping: vi.fn(async () => Promise.reject(new Error("stale"))), close };
    useConnectionStore.setState({
      status: "open",
      reconnection: { reconnectNow: vi.fn() } as never,
      daemon: daemon as never,
    });
    host.connection.onResume(createResumeHandler());

    host.emitResume();
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith(4000, "stale-connection-probe"));
    expect(daemon.ping).toHaveBeenCalledTimes(1);
    useConnectionStore.setState({ reconnection: null, daemon: null, status: "idle" });
  });
});
