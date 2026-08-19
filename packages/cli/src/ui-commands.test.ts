import { describe, expect, it, vi } from "vitest";

import { buildServeUrl, runServeUi, DEFAULT_UI_HOST } from "./ui-commands.js";
import type { CliContext } from "./cli-core.js";
import { connectDaemon } from "./connection.js";
import * as webServer from "./web-server.js";
import type { WebServerHandle } from "./web-server.js";

function ctxWith(): { ctx: CliContext; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    connect: (opts) => connectDaemon(opts),
    sink: { write: (l) => out.push(l), error: (l) => err.push(l) },
  };
  return { ctx, out, err };
}

describe("buildServeUrl", () => {
  it("returns the base url unchanged when no daemon host is given", () => {
    expect(buildServeUrl("http://127.0.0.1:4173/")).toBe("http://127.0.0.1:4173/");
  });

  it("injects host and connect query params when a daemon host is given", () => {
    const url = buildServeUrl("http://127.0.0.1:4173/", "workstation.local:6767");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("host")).toBe("ws://workstation.local:6767");
    expect(parsed.searchParams.get("connect")).toBe("1");
  });
});

describe("runServeUi", () => {
  it("reports an error and exits nonzero when the web-client build cannot be resolved", async () => {
    const { ctx, err } = ctxWith();
    const spy = vi.spyOn(webServer, "resolveWebClientDist").mockImplementation(() => {
      throw new Error("no build found");
    });
    const { code, handle } = await runServeUi(ctx, {});
    expect(code).toBe(1);
    expect(handle).toBeUndefined();
    expect(err.some((l) => l.includes("no build found"))).toBe(true);
    spy.mockRestore();
  });

  it("starts the server and prints the serve url on success", async () => {
    const { ctx, out } = ctxWith();
    const fakeHandle: WebServerHandle = {
      url: "http://127.0.0.1:4173/",
      close: async () => {},
    };
    const resolveSpy = vi.spyOn(webServer, "resolveWebClientDist").mockReturnValue("/tmp/dist");
    const startSpy = vi.spyOn(webServer, "startWebServer").mockResolvedValue(fakeHandle);

    const { code, handle } = await runServeUi(ctx, { host: DEFAULT_UI_HOST, port: "4173" });

    expect(code).toBe(0);
    expect(handle).toBe(fakeHandle);
    expect(out.some((l) => l.includes("http://127.0.0.1:4173/"))).toBe(true);
    expect(startSpy).toHaveBeenCalledWith({
      dir: "/tmp/dist",
      host: DEFAULT_UI_HOST,
      port: 4173,
    });

    resolveSpy.mockRestore();
    startSpy.mockRestore();
  });
});
