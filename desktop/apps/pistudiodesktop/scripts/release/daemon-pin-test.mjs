// Node's test runner: `node --test 'scripts/release/*-test.mjs'` in this app. The name ends in `-test`,
// not `.test`, so that the app's vitest run leaves it alone.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { compareVersions, pinOf, readMinVersion, run, TARGETS, waitForPin } from "./daemon-pin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "daemon-pin.mjs");
const CLI_ANSWERS = join(HERE, "../../../../crates/shell/src/cli_answers.rs");

const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "daemon-pin-"));
  dirs.push(dir);
  return dir;
};

/** A manifest as `daemon-manifest.mjs` writes it. */
const manifestOf = (version) => ({
  version,
  pub_date: "2026-11-24T10:00:00Z",
  assets: Object.fromEntries(
    TARGETS.map((target, i) => [target, { url: `https://example.test/daemon-v${version}/pi-studio-${version}-${target}.tar.gz`, sha256: String(i).repeat(64), size: 1000 + i }]),
  ),
});

/** A server answering with the next of `bodies` (the last one repeats); `body` is text or an object. */
async function serve(bodies) {
  let calls = 0;
  const server = createServer((request, response) => {
    const body = bodies[Math.min(calls++, bodies.length - 1)];
    response.writeHead(200, { "Content-Type": "application/json" }).end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/latest.json`, calls: () => calls };
}

describe("compareVersions and readMinVersion", () => {
  it("compares numerically", () => {
    assert.ok(compareVersions("0.0.131", "0.0.127") > 0);
    assert.ok(compareVersions("0.0.99", "0.0.127") < 0);
    assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
    assert.equal(compareVersions("0.0.127", "0.0.127"), 0);
  });

  it("reads the constant of the Rust source", () => {
    assert.equal(readMinVersion("pub const MIN_CLI_VERSION: Version = Version { major: 0, minor: 2, patch: 7 };"), "0.2.7");
    assert.equal(readMinVersion("pub const MIN_CLI_VERSION: Version = Version {\n    major: 1,\n    minor: 0,\n    patch: 0,\n};"), "1.0.0");
    assert.throws(() => readMinVersion("const OTHER: u8 = 1;"), /MIN_CLI_VERSION/);
  });

  it("reads the real source", () => {
    assert.match(readMinVersion(readFileSync(CLI_ANSWERS, "utf8")), /^\d+\.\d+\.\d+$/);
  });
});

describe("pinOf", () => {
  it("keeps the version and the four assets only", () => {
    const pin = pinOf({ ...manifestOf("0.0.131"), extra: true });
    assert.deepEqual(Object.keys(pin), ["version", "assets"]);
    assert.deepEqual(Object.keys(pin.assets), TARGETS);
  });

  it("refuses what is not a valid manifest", () => {
    const missingTarget = manifestOf("0.0.131");
    delete missingTarget.assets["darwin-x64"];
    const badSum = manifestOf("0.0.131");
    badSum.assets["linux-x64"].sha256 = "abc";
    const badVersion = { ...manifestOf("0.0.131"), version: "latest" };
    const badUrl = manifestOf("0.0.131");
    badUrl.assets["linux-x64"].url = "file:///etc/passwd";
    const badSize = manifestOf("0.0.131");
    badSize.assets["linux-x64"].size = 0;
    for (const [bad, message] of [
      [null, /not an object/],
      [badVersion, /valid `version`/],
      [{ version: "0.0.131" }, /no `assets`/],
      [missingTarget, /darwin-x64/],
      [badSum, /linux-x64 asset has no valid `sha256`/],
      [badUrl, /valid `url`/],
      [badSize, /valid `size`/],
    ]) {
      assert.throws(() => pinOf(bad), message);
    }
  });
});

describe("waitForPin and run", () => {
  it("writes the file for a good manifest", async () => {
    const { url } = await serve([manifestOf("0.0.131")]);
    const out = join(tempDir(), "daemon-pin.json");
    const { pin } = await run(["--manifest", url, "--min", "0.0.127", "--out", out]);
    assert.equal(pin.version, "0.0.131");
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), pinOf(manifestOf("0.0.131")));
  });

  it("takes the minimum from the Rust source", async () => {
    const dir = tempDir();
    const source = join(dir, "cli_answers.rs");
    writeFileSync(source, "pub const MIN_CLI_VERSION: Version = Version { major: 0, minor: 0, patch: 131 };");
    const { url } = await serve([manifestOf("0.0.131")]);
    await run(["--manifest", url, "--min-from", source, "--out", join(dir, "pin.json")]);
    const below = await serve([manifestOf("0.0.130")]);
    await assert.rejects(run(["--manifest", below.url, "--min-from", source, "--out", join(dir, "pin2.json")]), /no daemon binary ≥ 0\.0\.131 is published/);
  });

  it("waits while the manifest is below the minimum, then takes the new one", async () => {
    const server = await serve([manifestOf("0.0.126"), manifestOf("0.0.127")]);
    const lines = [];
    const pin = await waitForPin({ manifest: server.url, min: "0.0.127", waitMinutes: 1, retrySeconds: 0.01, log: (line) => lines.push(line) });
    assert.equal(pin.version, "0.0.127");
    assert.equal(server.calls(), 2);
    assert.match(lines[0], /names 0\.0\.126/);
  });

  it("fails after the wait when the manifest stays below the minimum", async () => {
    const server = await serve([manifestOf("0.0.126")]);
    const out = join(tempDir(), "pin.json");
    await assert.rejects(run(["--manifest", server.url, "--min", "0.0.127", "--out", out, "--wait-minutes", "0.001", "--retry-seconds", "0.01"]), /no daemon binary ≥ 0\.0\.127 is published/);
    assert.ok(server.calls() > 1);
    assert.throws(() => readFileSync(out));
  });

  it("makes one attempt without --wait-minutes", async () => {
    const server = await serve([manifestOf("0.0.126")]);
    await assert.rejects(waitForPin({ manifest: server.url, min: "0.0.127" }), /no daemon binary/);
    assert.equal(server.calls(), 1);
  });

  it("fails at once on a malformed manifest, without waiting", async () => {
    for (const body of ["not json", { version: "0.0.131" }]) {
      const server = await serve([body]);
      await assert.rejects(waitForPin({ manifest: server.url, min: "0.0.127", waitMinutes: 1, retrySeconds: 0.01 }), /not JSON|no `assets`/);
      assert.equal(server.calls(), 1);
    }
  });

  it("fails when the manifest is unreachable", async () => {
    await assert.rejects(waitForPin({ manifest: "http://127.0.0.1:1/latest.json", min: "0.0.127" }), /no daemon binary/);
  });

  it("exits non-zero from the command line with the message", async () => {
    const server = await serve([manifestOf("0.0.126")]);
    // Not spawnSync: it would block this process, which serves the manifest.
    const result = await new Promise((resolve) => {
      execFile(process.execPath, [SCRIPT, "--manifest", server.url, "--min", "0.0.127", "--out", join(tempDir(), "pin.json")], { encoding: "utf8" }, (error, stdout, stderr) => resolve({ status: error?.code ?? 0, stderr }));
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /daemon-pin: no daemon binary ≥ 0\.0\.127 is published/);
  });
});
