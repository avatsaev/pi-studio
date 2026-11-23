// Node's test runner: `node --test desktop/apps/pistudiodesktop/scripts/release/`.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { parseArgs, selfCheckSignatures } from "./self-check-signatures.mjs";

const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function makeDir(names) {
  const dir = mkdtempSync(join(tmpdir(), "self-check-sig-"));
  dirs.push(dir);
  for (const name of names) writeFileSync(join(dir, name), `bytes of ${name}`);
  return dir;
}

/** A signer that records its calls and writes `<file>.sig` naming the version it was asked for. */
function fakeSigner() {
  const calls = [];
  const sign = (version, file) => {
    calls.push({ version, file });
    writeFileSync(`${file}.sig`, `signed for ${version}`);
  };
  return { calls, sign };
}

describe("selfCheckSignatures", () => {
  it("signs a copy of each update file and keeps only the copy's signature beside the real file", () => {
    const dir = makeDir(["Pi Studio_0.3.0_amd64.AppImage", "Pi Studio_0.3.0_amd64.AppImage.sig", "Pi Studio_0.3.0_amd64.deb", "Pi Studio_0.3.0_amd64.deb.sig", "Pi Studio_0.3.0_amd64.dmg"]);
    writeFileSync(join(dir, "Pi Studio_0.3.0_amd64.AppImage.sig"), "the bundler's signature");
    const { calls, sign } = fakeSigner();
    const made = selfCheckSignatures({ dir, version: "0.3.0", sign });
    assert.deepEqual(made, ["Pi Studio_0.3.0_amd64.AppImage.selfcheck.sig", "Pi Studio_0.3.0_amd64.deb.selfcheck.sig"]);
    assert.deepEqual(calls.map((c) => c.version), ["0.3.1-selfcheck", "0.3.1-selfcheck"]);
    // The signed copies carry the GitHub asset name, and are not the real files.
    assert.ok(calls.every((c) => /Pi\.Studio_0\.3\.0_amd64\.(AppImage|deb)$/.test(c.file) && !c.file.startsWith(dir)));
    assert.equal(readFileSync(join(dir, "Pi Studio_0.3.0_amd64.AppImage.selfcheck.sig"), "utf8"), "signed for 0.3.1-selfcheck");
    // The bundler's own signature is untouched; nothing is left of the scratch copies.
    assert.equal(readFileSync(join(dir, "Pi Studio_0.3.0_amd64.AppImage.sig"), "utf8"), "the bundler's signature");
    assert.ok(!existsSync(calls[0].file));
    assert.equal(readdirSync(dir).length, 7);
  });

  it("fails when the directory holds no update file", () => {
    const dir = makeDir(["notes.md", "Pi Studio_0.3.0_amd64.dmg"]);
    assert.throws(() => selfCheckSignatures({ dir, version: "0.3.0", sign: fakeSigner().sign }), /no update file/);
  });

  it("fails when a version is not major.minor.patch", () => {
    const dir = makeDir(["Pi Studio_0.3.0_amd64.deb"]);
    assert.throws(() => selfCheckSignatures({ dir, version: "0.3", sign: fakeSigner().sign }), /major\.minor\.patch/);
  });

  it("fails and cleans up when the signer fails", () => {
    const dir = makeDir(["Pi Studio_0.3.0_amd64.deb"]);
    assert.throws(() => selfCheckSignatures({ dir, version: "0.3.0", sign: () => { throw new Error("no key"); } }), /no key/);
    assert.equal(readdirSync(dir).length, 1);
  });
});

describe("parseArgs", () => {
  it("reads --dir and --version", () => {
    assert.deepEqual(parseArgs(["--dir", "d", "--version", "0.3.0"]), { dir: "d", version: "0.3.0" });
  });
  it("refuses a missing or an unknown option", () => {
    assert.throws(() => parseArgs(["--dir", "d"]), /--version is required/);
    assert.throws(() => parseArgs(["--dir", "d", "--version", "1.0.0", "--out", "x"]), /unknown argument/);
  });
});
