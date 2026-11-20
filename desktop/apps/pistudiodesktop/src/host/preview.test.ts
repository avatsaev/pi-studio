import { describe, expect, it, vi } from "vitest";

import { type Ipc } from "./ipc.js";
import { createDesktopPreview } from "./preview.js";

const fake = (impl: Ipc["invoke"]) => ({ invoke: vi.fn<Ipc["invoke"]>(impl) });
const log = vi.fn<(m: string, e: unknown) => void>();

describe("desktop preview", () => {
  it("mounts and releases once", async () => {
    const ipc = fake(async (cmd) => (cmd === "preview_mount" ? { url: "pi-preview://localhost/ab" } : undefined));
    const preview = createDesktopPreview("origin", ipc, log);
    if (preview.kind !== "origin") throw new Error("kind");
    const mounted = await preview.mount("<p>x</p>");
    expect(mounted.url).toBe("pi-preview://localhost/ab");
    expect(ipc.invoke).toHaveBeenCalledWith("preview_mount", { html: "<p>x</p>" });
    mounted.release();
    mounted.release();
    const releases = ipc.invoke.mock.calls.filter(([c]) => c === "preview_release");
    expect(releases).toEqual([["preview_release", { url: "pi-preview://localhost/ab" }]]);
  });

  it("rejects mount with the reason", async () => {
    const preview = createDesktopPreview("origin", fake(() => Promise.reject(new Error("caps"))), log);
    if (preview.kind !== "origin") throw new Error("kind");
    await expect(preview.mount("x")).rejects.toThrow("caps");
  });

  it("inert sends nothing", () => {
    const ipc = fake(async () => undefined);
    expect(createDesktopPreview("inert", ipc, log)).toEqual({ kind: "inert" });
    expect(ipc.invoke).not.toHaveBeenCalled();
  });
});
