import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, afterEach } from "vitest";

import { startWebServer, type WebServerHandle } from "./web-server.js";

function tmpDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-cli-web-"));
  writeFileSync(join(dir, "index.html"), "<html>root</html>");
  writeFileSync(join(dir, "app.js"), "console.log('hi');");
  return dir;
}

describe("startWebServer", () => {
  let handle: WebServerHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("serves index.html at the root", async () => {
    const dir = tmpDist();
    handle = await startWebServer({ dir, host: "127.0.0.1", port: 0 });
    const res = await fetch(handle.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>root</html>");
  });

  it("serves a known asset with the correct content type", async () => {
    const dir = tmpDist();
    handle = await startWebServer({ dir, host: "127.0.0.1", port: 0 });
    const res = await fetch(new URL("app.js", handle.url));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(await res.text()).toBe("console.log('hi');");
  });

  it("falls back to index.html for an unknown client-side route", async () => {
    const dir = tmpDist();
    handle = await startWebServer({ dir, host: "127.0.0.1", port: 0 });
    const res = await fetch(new URL("sessions/abc123", handle.url));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>root</html>");
  });

  it("404s for an unknown path that looks like a real asset", async () => {
    const dir = tmpDist();
    handle = await startWebServer({ dir, host: "127.0.0.1", port: 0 });
    const res = await fetch(new URL("missing.js", handle.url));
    expect(res.status).toBe(404);
  });
});
