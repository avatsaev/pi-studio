import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ready, Session, tauriCapabilities, WebDriverError, webkitCapabilities } from "./webdriver.mjs";

describe("capabilities", () => {
  it("tauri: names the application and its arguments for tauri-driver", () => {
    expect(tauriCapabilities({ application: "C:\\app.exe", args: ["--config-dir", "C:\\c"] })).toEqual({
      capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: "C:\\app.exe", args: ["--config-dir", "C:\\c"] } } },
    });
  });

  it("webkit: names the binary for WebKitWebDriver", () => {
    expect(webkitCapabilities({ application: "/a", args: ["x"] }).capabilities.alwaysMatch["webkitgtk:browserOptions"]).toEqual({ binary: "/a", args: ["x"] });
  });
});

describe("Session", () => {
  const servers = [];
  afterEach(() => servers.splice(0).forEach((server) => server.close()));

  /** A fake WebDriver: records requests, answers from `answer(method, url, body)`. */
  async function fakeDriver(answer) {
    const requests = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = body ? JSON.parse(body) : undefined;
        requests.push({ method: req.method, url: req.url, body: parsed });
        const [status, value] = answer(req.method, req.url, parsed);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ value }));
      });
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { base: `http://127.0.0.1:${server.address().port}`, requests };
  }

  it("opens a session, runs scripts and invokes commands", async () => {
    const { base, requests } = await fakeDriver((method, url) => {
      if (url === "/session") return [200, { sessionId: "s1" }];
      if (url.endsWith("/execute/async")) return [200, { ok: true, value: 42 }];
      return [200, null];
    });
    const session = await Session.open(base, tauriCapabilities({ application: "a", args: [] }));
    expect(session.id).toBe("s1");
    await expect(session.invoke("boot")).resolves.toEqual({ ok: true, value: 42 });
    const invoke = requests.find((r) => r.url === "/session/s1/execute/async");
    expect(invoke.body.args).toEqual(["boot", {}]);
    expect(invoke.body.script).toContain("__TAURI_INTERNALS__.invoke");
  });

  it("raises a WebDriver error with its name and message", async () => {
    const { base } = await fakeDriver(() => [404, { error: "no such element", message: "gone" }]);
    await expect(Session.open(base, {})).rejects.toMatchObject({ name: "WebDriverError", error: "no such element", message: "no such element: gone" });
    await expect(Session.open(base, {})).rejects.toBeInstanceOf(WebDriverError);
  });

  it("finds elements by CSS and by their text", async () => {
    const key = "element-6066-11e4-a52e-4f735466cecf";
    const { base, requests } = await fakeDriver((method, url) => {
      if (url === "/session") return [200, { sessionId: "s" }];
      if (url === "/session/s/elements") return [200, [{ [key]: "e1" }, { [key]: "e2" }]];
      if (url === "/session/s/execute/sync") return [200, { [key]: "e7" }];
      return [200, null];
    });
    const session = await Session.open(base, {});
    const elements = await session.findAll("button");
    expect(elements).toEqual(["e1", "e2"]);
    await expect(session.findByText("button", "Hello")).resolves.toBe("e7");
    expect(requests.find((r) => r.url === "/session/s/execute/sync").body.args).toEqual(["button", "Hello"]);
    await session.click("e2");
    expect(requests.at(-1)).toMatchObject({ method: "POST", url: "/session/s/element/e2/click" });
  });

  it("writes a screenshot from the base64 PNG", async () => {
    const { base } = await fakeDriver((method, url) => (url === "/session" ? [200, { sessionId: "s" }] : [200, Buffer.from("PNGDATA").toString("base64")]));
    const session = await Session.open(base, {});
    const file = path.join(mkdtempSync(path.join(tmpdir(), "wd-test-")), "shot.png");
    await session.screenshot(file);
    expect(readFileSync(file, "utf8")).toBe("PNGDATA");
  });

  it("says whether a server answers /status", async () => {
    const { base } = await fakeDriver(() => [200, { ready: true }]);
    await expect(ready(base)).resolves.toBe(true);
    await expect(ready("http://127.0.0.1:1")).resolves.toBe(false);
  });
});
