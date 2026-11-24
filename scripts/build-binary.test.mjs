// Pure parts of build-binary.mjs. Run with `node --test scripts/build-binary.test.mjs` (the root
// vitest run only discovers `packages/*`).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BUN_SCRIPT, TARGETS, folderName, parseArgs, piAssets } from "./build-binary.mjs";

test("the four release targets map to Bun targets", () => {
  assert.deepEqual(TARGETS, {
    "linux-x64": "bun-linux-x64",
    "linux-arm64": "bun-linux-arm64",
    "darwin-arm64": "bun-darwin-arm64",
    "darwin-x64": "bun-darwin-x64",
  });
});

test("parseArgs takes --target in both spellings and rejects the rest", () => {
  assert.deepEqual(parseArgs(["--target", "linux-x64"]), { target: "linux-x64" });
  assert.deepEqual(parseArgs(["--target=darwin-arm64"]), { target: "darwin-arm64" });
  assert.throws(() => parseArgs([]), /--target is required/);
  assert.throws(() => parseArgs(["--target", "win32-x64"]), /unknown target/);
  assert.throws(() => parseArgs(["--all"]), /unknown argument/);
});

test("folderName is the archive's top folder", () => {
  assert.equal(folderName("0.0.131", "linux-x64"), "pi-studio-0.0.131-linux-x64");
});

test("the bun script starts the executable beside it as Bun", () => {
  assert.match(BUN_SCRIPT, /^#!\/bin\/sh\n/);
  assert.match(BUN_SCRIPT, /BUN_BE_BUN=1 exec "\$\(dirname "\$0"\)\/pi-studio" "\$@"/);
});

test("piAssets lists Pi's files by extension and keeps the wasm", () => {
  const pi = mkdtempSync(join(tmpdir(), "pi-assets-"));
  for (const dir of [
    "dist/modes/interactive/theme",
    "dist/modes/interactive/assets",
    "dist/core/export-html/vendor",
  ]) {
    mkdirSync(join(pi, dir), { recursive: true });
  }
  writeFileSync(join(pi, "dist/modes/interactive/theme/dark.json"), "{}");
  writeFileSync(join(pi, "dist/modes/interactive/theme/theme.js"), "");
  writeFileSync(join(pi, "dist/modes/interactive/assets/logo.png"), "");
  writeFileSync(join(pi, "dist/core/export-html/vendor/marked.min.js"), "");

  const targets = piAssets(pi, "/w/photon_rs_bg.wasm").map((asset) => asset.to);
  assert.deepEqual(
    targets.toSorted(),
    [
      "CHANGELOG.md",
      "README.md",
      "assets/logo.png",
      "docs",
      "export-html/template.css",
      "export-html/template.html",
      "export-html/vendor/marked.min.js",
      "package.json",
      "photon_rs_bg.wasm",
      "theme/dark.json",
    ].toSorted(),
  );
});
