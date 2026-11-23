// Node's test runner: `node --test desktop/apps/pistudiodesktop/scripts/release/`. The name ends in
// `-test` and not `.test`, so that the app's vitest run (which takes `*.test.mjs`) leaves it alone.
//
// The committed fixtures (`fixtures/*.json`) are what the script makes of `makeRelease()`'s files;
// `src-tauri/tests/update_manifest.rs` reads them with the plug-in's own type. To remake them after
// a change to the script: `UPDATE_FIXTURES=1 node --test desktop/apps/pistudiodesktop/scripts/release/`.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { assetUrl, buildManifest, KINDS, parseArgs, run, selfCheckVersion } from "./update-manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const VERSION = "0.3.0";
const BASE_URL = `https://github.com/avatsaev/pi-studio/releases/download/desktop-v${VERSION}`;
const RELEASE_URL = `https://github.com/avatsaev/pi-studio/releases/tag/desktop-v${VERSION}`;
const PUB_DATE = "2026-11-23T10:00:00Z";

/** The bundler's file names for version N (macOS and Windows names as the bundler writes them: spaces included). */
const fileNames = (version) => ({
  appimage: `Pi Studio_${version}_amd64.AppImage`,
  deb: `Pi Studio_${version}_amd64.deb`,
  rpm: `Pi Studio-${version}-1.x86_64.rpm`,
  app: "Pi Studio.app.tar.gz",
  nsis: `Pi Studio_${version}_x64-setup.exe`,
  msi: `Pi Studio_${version}_x64_en-US.msi`,
});

/** A stand-in for a `.sig`: the base64 text the signer writes, with a trailing newline. */
const signatureOf = (name) => `${Buffer.from(`untrusted comment: signature of ${name}\nRUQ-not-a-real-signature`).toString("base64")}\n`;

const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A directory of update files and signatures; `without`/`unsigned` drop a kind's file/signature. */
function makeRelease({ version = VERSION, without = [], unsigned = [], extra = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "update-manifest-"));
  dirs.push(dir);
  for (const [kind, name] of Object.entries(fileNames(version))) {
    if (without.includes(kind)) continue;
    writeFileSync(join(dir, name), `bytes of ${name}`);
    if (!unsigned.includes(kind)) writeFileSync(join(dir, `${name}.sig`), signatureOf(name));
  }
  for (const name of extra) writeFileSync(join(dir, name), "extra");
  return dir;
}

const options = (dir, more = {}) => ({ dir, version: VERSION, baseUrl: BASE_URL, releaseUrl: RELEASE_URL, pubDate: PUB_DATE, ...more });

/** Semver precedence of `a` against `b` (-1, 0, 1), for `major.minor.patch[-tag]`. */
function compareSemver(a, b) {
  const [[core1, pre1], [core2, pre2]] = [a, b].map((v) => v.split(/-(.*)/s));
  const [x, y] = [core1, core2].map((core) => core.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  if (pre1 === pre2) return 0;
  if (pre1 === undefined) return 1;
  if (pre2 === undefined) return -1;
  return pre1 < pre2 ? -1 : 1;
}

describe("buildManifest", () => {
  it("names every target of a complete set, with the files' URLs and signatures", () => {
    const manifest = buildManifest(options(makeRelease()));
    assert.equal(manifest.version, VERSION);
    assert.equal(manifest.pub_date, PUB_DATE);
    assert.equal(manifest.notes, RELEASE_URL);
    assert.deepEqual(Object.keys(manifest.platforms), [
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "linux-x86_64-rpm",
      "darwin-aarch64",
      "darwin-x86_64",
      "windows-x86_64-nsis",
      "windows-x86_64-msi",
    ]);
    const names = fileNames(VERSION);
    const expected = {
      "linux-x86_64-appimage": names.appimage,
      "linux-x86_64-deb": names.deb,
      "linux-x86_64-rpm": names.rpm,
      "darwin-aarch64": names.app,
      "darwin-x86_64": names.app,
      "windows-x86_64-nsis": names.nsis,
      "windows-x86_64-msi": names.msi,
    };
    for (const [target, file] of Object.entries(expected)) {
      assert.equal(manifest.platforms[target].url, `${BASE_URL}/${file.replaceAll(" ", ".")}`, target);
      assert.equal(manifest.platforms[target].signature, signatureOf(file).trim(), target);
    }
  });

  it("serves both macOS targets from the one universal file", () => {
    const { platforms } = buildManifest(options(makeRelease()));
    assert.deepEqual(platforms["darwin-aarch64"], platforms["darwin-x86_64"]);
    assert.equal(platforms["darwin-aarch64"].url, `${BASE_URL}/Pi.Studio.app.tar.gz`);
  });

  it("is not confused by signatures, the other manifest, or the installers it ignores", () => {
    const dir = makeRelease({ extra: ["Pi Studio_0.3.0_universal.dmg", "latest.json", "self-check.json"] });
    assert.equal(Object.keys(buildManifest(options(dir)).platforms).length, 7);
  });

  it("fails when a file has no signature, and says which", () => {
    const dir = makeRelease({ unsigned: ["deb"] });
    assert.throws(() => buildManifest(options(dir)), /signature Pi Studio_0\.3\.0_amd64\.deb\.sig/);
  });

  it("fails on an unsigned file even when its kind is not required", () => {
    const dir = makeRelease({ unsigned: ["msi"] });
    assert.throws(() => buildManifest(options(dir, { require: ["appimage"] })), /\.msi\.sig/);
  });

  it("fails on an empty signature", () => {
    const dir = makeRelease();
    writeFileSync(join(dir, `${fileNames(VERSION).rpm}.sig`), "\n");
    assert.throws(() => buildManifest(options(dir)), /\.rpm\.sig \(empty\)/);
  });

  it("fails when a required kind has no file, and lists every missing kind", () => {
    const dir = makeRelease({ without: ["rpm", "msi"] });
    assert.throws(
      () => buildManifest(options(dir)),
      (error) => /rpm update file/.test(error.message) && /msi update file/.test(error.message),
    );
  });

  it("leaves out a missing kind that is not required", () => {
    const dir = makeRelease({ without: ["rpm", "msi", "app"] });
    const { platforms } = buildManifest(options(dir, { require: ["appimage", "deb", "nsis"] }));
    assert.deepEqual(Object.keys(platforms), ["linux-x86_64-appimage", "linux-x86_64-deb", "windows-x86_64-nsis"]);
  });

  it("fails when the directory holds no update file", () => {
    const dir = makeRelease({ without: Object.keys(KINDS) });
    assert.throws(() => buildManifest(options(dir, { require: ["deb"] })), /deb update file/);
  });

  it("fails on two files of one kind", () => {
    const dir = makeRelease({ extra: ["Other_amd64.deb"] });
    assert.throws(() => buildManifest(options(dir)), /more than one deb/);
  });

  it("refuses a version that is not major.minor.patch, and a URL that is not one", () => {
    const dir = makeRelease();
    assert.throws(() => buildManifest(options(dir, { version: "0.3" })), /major\.minor\.patch/);
    assert.throws(() => buildManifest(options(dir, { version: "0.3.0-rc.1" })), /major\.minor\.patch/);
    assert.throws(() => buildManifest(options(dir, { baseUrl: "not a url" })), /--base-url/);
    assert.throws(() => buildManifest(options(dir, { releaseUrl: "" })), /--release-url/);
  });
});

describe("the self check", () => {
  it("offers the same files under a version greater than N", () => {
    const dir = makeRelease();
    const latest = buildManifest(options(dir));
    const selfCheck = buildManifest(options(dir, { selfCheck: true }));
    assert.equal(selfCheck.version, "0.3.1-selfcheck");
    assert.deepEqual(selfCheck.platforms, latest.platforms);
    assert.equal(selfCheck.notes, latest.notes);
    assert.equal(compareSemver(selfCheck.version, VERSION), 1);
  });

  it("orders after N for every N, comparing numbers as numbers", () => {
    for (const version of ["0.3.0", "0.3.9", "1.2.99", "10.0.0", "0.0.0"]) {
      const next = selfCheckVersion(version);
      assert.equal(compareSemver(next, version), 1, `${next} > ${version}`);
    }
    assert.equal(selfCheckVersion("0.3.9"), "0.3.10-selfcheck");
  });

  it("is still older than the release that follows N", () => {
    assert.equal(compareSemver(selfCheckVersion("0.3.0"), "0.3.1"), -1);
  });
});

describe("assetUrl", () => {
  it("turns each space into a dot, as GitHub names an uploaded file", () => {
    assert.equal(assetUrl(BASE_URL, "Pi Studio.app.tar.gz"), `${BASE_URL}/Pi.Studio.app.tar.gz`);
    assert.equal(assetUrl(`${BASE_URL}/`, "Pi Studio_0.3.0_amd64.deb"), `${BASE_URL}/Pi.Studio_0.3.0_amd64.deb`);
  });

  it("refuses a name GitHub may rewrite in another way", () => {
    assert.throws(() => assetUrl(BASE_URL, "Pi Studio+beta.deb"), /may rewrite/);
  });
});

describe("the command line", () => {
  const argv = (dir, ...more) => ["--dir", dir, "--version", VERSION, "--base-url", BASE_URL, "--release-url", RELEASE_URL, "--pub-date", PUB_DATE, ...more];

  it("writes latest.json in the directory, and self-check.json with --self-check", () => {
    const dir = makeRelease();
    assert.equal(run(argv(dir)), join(dir, "latest.json"));
    assert.equal(JSON.parse(readFileSync(join(dir, "latest.json"), "utf8")).version, VERSION);
    assert.equal(run(argv(dir, "--self-check")), join(dir, "self-check.json"));
    assert.equal(JSON.parse(readFileSync(join(dir, "self-check.json"), "utf8")).version, "0.3.1-selfcheck");
  });

  it("takes --require and --out", () => {
    const dir = makeRelease({ without: ["app", "rpm"] });
    const out = join(dir, "out.json");
    assert.equal(run(argv(dir, "--require", "appimage,deb", "--out", out)), out);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(out, "utf8")).platforms), ["linux-x86_64-appimage", "linux-x86_64-deb", "windows-x86_64-nsis", "windows-x86_64-msi"]);
  });

  it("rejects a missing option, an unknown option and an unknown kind", () => {
    assert.throws(() => parseArgs(["--dir", "d"]), /--version is required/);
    assert.throws(() => parseArgs([...argv("d"), "--bogus"]), /unknown argument "--bogus"/);
    assert.throws(() => parseArgs([...argv("d"), "--require", "zip"]), /--require names kinds/);
    assert.throws(() => parseArgs(argv("d").slice(0, -1)), /needs a value/);
  });
});

describe("the committed fixtures", () => {
  const dir = makeRelease();
  const made = { "latest.json": buildManifest(options(dir)), "self-check.json": buildManifest(options(dir, { selfCheck: true })) };

  if (process.env.UPDATE_FIXTURES === "1") {
    mkdirSync(FIXTURES, { recursive: true });
    for (const [name, manifest] of Object.entries(made)) writeFileSync(join(FIXTURES, name), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  for (const [name, manifest] of Object.entries(made)) {
    it(`${name} is what the script makes`, () => {
      assert.deepEqual(JSON.parse(readFileSync(join(FIXTURES, name), "utf8")), manifest);
    });
  }
});
