// Node's test runner: `node --test desktop/apps/pistudiodesktop/scripts/release/`.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createFileServer, resolveRequest } from "./serve-directory.mjs";

let dir;
let server;
let base;
const lines = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "serve-directory-"));
  writeFileSync(join(dir, "Pi.Studio_0.3.0_amd64.deb"), "deb bytes");
  mkdirSync(join(dir, "sub"));
  server = createFileServer(dir, (line) => lines.push(line));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveRequest", () => {
  it("finds a file of the directory by its name, also percent-encoded", () => {
    assert.equal(resolveRequest(dir, "/Pi.Studio_0.3.0_amd64.deb"), join(dir, "Pi.Studio_0.3.0_amd64.deb"));
    assert.equal(resolveRequest(dir, "/Pi.Studio_0.3.0_amd64.deb?x=1"), join(dir, "Pi.Studio_0.3.0_amd64.deb"));
  });

  it("refuses a directory, a missing file, a path with a segment and an escape", () => {
    for (const request of ["/", "/sub", "/missing", "/sub/x", "/%2e%2e/x", "/..%2Fx", "/%5Cx", "/%E0%A4%A"]) assert.equal(resolveRequest(dir, request), null, request);
  });
});

describe("the server", () => {
  it("serves a file with its length, and logs the request", async () => {
    const response = await fetch(`${base}/Pi.Studio_0.3.0_amd64.deb`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "deb bytes");
    assert.equal(response.headers.get("content-length"), "9");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(lines.includes("GET /Pi.Studio_0.3.0_amd64.deb 200 9"), lines.join("|"));
  });

  it("answers 404 for a missing file and 405 for a write", async () => {
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    assert.equal((await fetch(`${base}/Pi.Studio_0.3.0_amd64.deb`, { method: "POST", body: "x" })).status, 405);
  });
});
