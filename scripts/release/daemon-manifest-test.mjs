// Node's test runner: `node --test 'scripts/release/*-test.mjs'` at the repository root. The name ends
// in `-test`, like the desktop release scripts' tests.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { archiveName, buildFiles, parseArgs, run, TARGETS } from "./daemon-manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = "0.0.131";
const BASE_URL = `https://github.com/avatsaev/pi-studio/releases/download/daemon-v${VERSION}`;
const PUB_DATE = "2026-11-24T10:00:00Z";

const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** The bytes of a stand-in archive: different per name. */
const contentOf = (name) => Buffer.from(`archive of ${name}`);

/** A directory with the archives of `targets` at `version` (default: all four), and `extra` names. */
function makeDir({ version = VERSION, targets = TARGETS, extra = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "daemon-manifest-"));
  dirs.push(dir);
  for (const name of [...targets.map((target) => archiveName(version, target)), ...extra]) {
    writeFileSync(join(dir, name), contentOf(name));
  }
  return dir;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

describe("buildFiles", () => {
  it("makes the manifest and the checksums of a complete set", () => {
    const dir = makeDir();
    const { manifest, sums } = buildFiles({
      dir,
      version: VERSION,
      baseUrl: `${BASE_URL}/`,
      pubDate: PUB_DATE,
    });
    const assets = Object.fromEntries(
      TARGETS.map((target) => {
        const name = archiveName(VERSION, target);
        return [
          target,
          {
            url: `${BASE_URL}/${name}`,
            sha256: sha256(contentOf(name)),
            size: contentOf(name).length,
          },
        ];
      }),
    );
    assert.deepEqual(manifest, { version: VERSION, pub_date: PUB_DATE, assets });
    assert.deepEqual(Object.keys(manifest.assets), TARGETS);
    assert.equal(
      sums,
      TARGETS.map((target) => `${assets[target].sha256}  ${archiveName(VERSION, target)}`).join(
        "\n",
      ) + "\n",
    );
  });

  it("names the missing target", () => {
    const dir = makeDir({ targets: TARGETS.filter((target) => target !== "darwin-arm64") });
    assert.throws(
      () => buildFiles({ dir, version: VERSION, baseUrl: BASE_URL }),
      /missing target darwin-arm64/,
    );
  });

  it("refuses an extra archive", () => {
    const dir = makeDir({ extra: [`pi-studio-${VERSION}-linux-riscv64.tar.gz`] });
    assert.throws(
      () => buildFiles({ dir, version: VERSION, baseUrl: BASE_URL }),
      /unexpected archive.*linux-riscv64/,
    );
  });

  it("refuses an archive named for another version", () => {
    const dir = makeDir({
      targets: TARGETS.filter((target) => target !== "linux-x64"),
      extra: [archiveName("0.0.130", "linux-x64")],
    });
    assert.throws(
      () => buildFiles({ dir, version: VERSION, baseUrl: BASE_URL }),
      /unexpected archive.*0\.0\.130/,
    );
  });

  it("ignores files that are not archives (a previous run's output)", () => {
    const dir = makeDir({ extra: ["SHA256SUMS", "latest.json"] });
    assert.doesNotThrow(() => buildFiles({ dir, version: VERSION, baseUrl: BASE_URL }));
  });

  it("refuses a version that is not major.minor.patch", () => {
    assert.throws(
      () => buildFiles({ dir: makeDir(), version: "0.0.131-rc1", baseUrl: BASE_URL }),
      /not <major>/,
    );
  });
});

describe("parseArgs and run", () => {
  it("reads the options and requires the three", () => {
    assert.deepEqual(
      parseArgs(["--version", "1.0.0", "--dir", "d", "--base-url", "u", "--pub-date", "p"]),
      { version: "1.0.0", dir: "d", baseUrl: "u", pubDate: "p" },
    );
    assert.throws(() => parseArgs(["--version", "1.0.0", "--dir", "d"]), /--base-url is required/);
    assert.throws(() => parseArgs(["--nope", "x"]), /unknown argument/);
    assert.throws(() => parseArgs(["--version"]), /needs a value/);
  });

  it("writes SHA256SUMS and latest.json into the directory, and the sums verify", () => {
    const dir = makeDir();
    const [sumsPath, manifestPath] = run([
      "--version",
      VERSION,
      "--dir",
      dir,
      "--base-url",
      BASE_URL,
      "--pub-date",
      PUB_DATE,
    ]);
    assert.equal(sumsPath, join(dir, "SHA256SUMS"));
    assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).version, VERSION);
    execFileSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: dir, stdio: "pipe" });
  });

  it("exits non-zero naming the missing target, and writes nothing", () => {
    const dir = makeDir({ targets: ["linux-x64"] });
    const result = spawnSync(
      process.execPath,
      [
        join(HERE, "daemon-manifest.mjs"),
        "--version",
        VERSION,
        "--dir",
        dir,
        "--base-url",
        BASE_URL,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing targets linux-arm64, darwin-arm64, darwin-x64/);
    assert.throws(() => readFileSync(join(dir, "latest.json")));
  });
});
