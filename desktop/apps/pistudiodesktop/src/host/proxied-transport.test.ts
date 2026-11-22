import { type Transport } from "@av-pi-studio/client";
import { describe, expect, it, vi } from "vitest";

import { type Ipc } from "./ipc.js";
import { LOCAL_CONNECTION_MESSAGE, createProxiedTransport } from "./proxied-transport.js";

const TOKEN = "MARKER-TOKEN-123";
const LOCAL = `ws://127.0.0.1:4000/${TOKEN}`;

function fakeInner(connect: (url: string) => Promise<void> = async () => undefined) {
  const connectSpy = vi.fn<(url: string) => Promise<void>>(connect);
  const sendText = vi.fn<(data: string) => void>();
  const inner: Transport = {
    connect: connectSpy,
    sendText,
    sendBinary: vi.fn<(data: Uint8Array) => void>(),
    close: vi.fn<(code?: number, reason?: string) => void>(),
    isOpen: true,
    bufferedAmount: 7,
    onMessage: null,
    onClose: null,
    onError: null,
  };
  return { inner, connectSpy, sendText };
}

describe("createProxiedTransport", () => {
  it("opens through Rust and connects the inner transport to the answer", async () => {
    const { inner, connectSpy, sendText } = fakeInner();
    const invoke = vi.fn<Ipc["invoke"]>(async () => ({ localUrl: LOCAL }));
    const t = createProxiedTransport({ invoke } as Ipc, () => inner);
    await t.connect("wss://daemon");
    expect(invoke).toHaveBeenCalledWith("transport_open", { url: "wss://daemon" });
    expect(connectSpy).toHaveBeenCalledWith(LOCAL);
    expect(t.bufferedAmount).toBe(7);
    expect(t.isOpen).toBe(true);
    t.sendText("a");
    expect(sendText).toHaveBeenCalledWith("a");
  });

  it("rejects with the command's message and leaves the inner transport alone", async () => {
    const { inner, connectSpy } = fakeInner();
    const invoke = vi.fn<Ipc["invoke"]>(async () => {
      throw { code: "dial_failed", message: "wrong password" };
    });
    const t = createProxiedTransport({ invoke } as Ipc, () => inner);
    await expect(t.connect("wss://d")).rejects.toThrow("wrong password");
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("rejects a failed inner connect with the local_connection message, without the address", async () => {
    const { inner } = fakeInner(async () => {
      throw new Error(`failed ${LOCAL}`);
    });
    const t = createProxiedTransport({ invoke: async () => ({ localUrl: LOCAL }) }, () => inner);
    const error = await t.connect("wss://d").catch((e: Error) => e);
    expect((error as Error).message).toBe(LOCAL_CONNECTION_MESSAGE);
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).not.toContain("127.0.0.1:4000");
  });

  it("asks Rust on every connect and forwards handlers set before or after", async () => {
    const { inner } = fakeInner();
    const invoke = vi.fn<Ipc["invoke"]>(async () => ({ localUrl: LOCAL }));
    const t = createProxiedTransport({ invoke } as Ipc, () => inner);
    const early = vi.fn<(data: string | ArrayBuffer | Blob) => void>();
    t.onMessage = early;
    await t.connect("wss://d");
    const late = vi.fn<(code: number, reason: string) => void>();
    t.onClose = late;
    inner.onMessage?.("x");
    inner.onClose?.(1000, "");
    await t.connect("wss://d");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(early).toHaveBeenCalledWith("x");
    expect(late).toHaveBeenCalledWith(1000, "");
    expect(t.onMessage).toBe(early);
  });

  it("never logs or throws the local address", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const { inner } = fakeInner(async () => {
      throw new Error(LOCAL);
    });
    const t = createProxiedTransport({ invoke: async () => ({ localUrl: LOCAL }) }, () => inner);
    const error = await t.connect("wss://d").catch((e: Error) => e);
    expect(String(error)).not.toContain(TOKEN);
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain(TOKEN);
      s.mockRestore();
    }
  });
});
