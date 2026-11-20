import { describe, expect, it, vi } from "vitest";

import { createDesktopStorage } from "./storage.js";

describe("desktop storage", () => {
  it("reads the snapshot, and a set value at once", () => {
    const s = createDesktopStorage({ a: "1" }, async () => undefined, () => undefined);
    expect(s.get("a")).toBe("1");
    expect(s.get("b")).toBeNull();
    s.set("b", "2");
    expect(s.get("b")).toBe("2");
  });

  it("sends storage values and does not throw when the send rejects", async () => {
    const log = vi.fn<(message: string, error: unknown) => void>();
    const s = createDesktopStorage({}, () => Promise.reject(new Error("no")), log);
    expect(() => s.set("k", "v")).not.toThrow();
    expect(s.get("k")).toBe("v");
    await s.settled();
    expect(log).toHaveBeenCalledOnce();
  });

  it("survives a synchronous throw in the send", async () => {
    const s = createDesktopStorage({}, () => { throw new Error("sync"); }, () => undefined);
    expect(() => s.set("k", "v")).not.toThrow();
    await s.settled();
  });

  it("settles once every sent write is answered", async () => {
    const answers: (() => void)[] = [];
    const s = createDesktopStorage({}, () => new Promise<void>((r) => answers.push(r)), () => undefined);
    s.set("a", "1");
    s.set("b", "2");
    let settled = false;
    void s.settled().then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    answers.forEach((r) => r());
    await s.settled();
    expect(settled).toBe(true);
  });
});
