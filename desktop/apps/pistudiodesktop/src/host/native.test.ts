import { describe, expect, it, vi } from "vitest";

import { type Ipc } from "./ipc.js";
import { createNativeDialogs, createNativeLinks, createNativeZoom } from "./native.js";

const fake = (impl: Ipc["invoke"]) => ({ invoke: vi.fn<Ipc["invoke"]>(impl) });

describe("native dialogs", () => {
  it("confirm resolves the answer", async () => {
    const yes = fake(async () => true);
    const no = fake(async () => false);
    expect(await createNativeDialogs(yes, vi.fn<(m: string, e: unknown) => void>()).confirm("m")).toBe(true);
    expect(yes.invoke).toHaveBeenCalledWith("dialog_confirm", { message: "m" });
    expect(await createNativeDialogs(no, vi.fn<(m: string, e: unknown) => void>()).confirm("m")).toBe(false);
  });

  it("confirm resolves false and logs when the call rejects", async () => {
    const log = vi.fn<(m: string, e: unknown) => void>();
    const ipc = fake(() => Promise.reject(new Error("x")));
    expect(await createNativeDialogs(ipc, log).confirm("m")).toBe(false);
    expect(log).toHaveBeenCalledOnce();
  });

  it("alert resolves on success and on failure", async () => {
    const ok = fake(async () => undefined);
    await createNativeDialogs(ok, vi.fn<(m: string, e: unknown) => void>()).alert("m");
    expect(ok.invoke).toHaveBeenCalledWith("dialog_alert", { message: "m" });
    const log = vi.fn<(m: string, e: unknown) => void>();
    await createNativeDialogs(fake(() => Promise.reject(new Error("x"))), log).alert("m");
    expect(log).toHaveBeenCalledOnce();
  });
});

describe("native links", () => {
  it("sends the URL unchanged without waiting", () => {
    const ipc = fake(() => new Promise(() => undefined));
    createNativeLinks(ipc, vi.fn<(m: string, e: unknown) => void>()).openExternal?.("https://a.b/?x=1");
    expect(ipc.invoke).toHaveBeenCalledWith("open_external", { url: "https://a.b/?x=1" });
  });

  it("logs a failure", async () => {
    const log = vi.fn<(m: string, e: unknown) => void>();
    createNativeLinks(fake(() => Promise.reject(new Error("x"))), log).openExternal?.("u");
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toHaveBeenCalledOnce();
  });
});

describe("native zoom", () => {
  it("sends the factor to Rust and logs a refusal", async () => {
    const ipc = fake(async () => null);
    createNativeZoom(ipc, vi.fn<(m: string, e: unknown) => void>()).set(1.25);
    expect(ipc.invoke).toHaveBeenCalledWith("window_set_zoom", { factor: 1.25 });
    const log = vi.fn<(m: string, e: unknown) => void>();
    createNativeZoom(fake(() => Promise.reject(new Error("x"))), log).set(3);
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toHaveBeenCalledOnce();
  });
});
