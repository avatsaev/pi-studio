// Pure parts of build-binary.mjs. Run with `node --test scripts/build-binary.test.mjs` (the root
// vitest run only discovers `packages/*`).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  BUN_SCRIPT,
  TARGETS,
  codesignArgs,
  folderName,
  parseArgs,
  piAssets,
  versionModule,
  withVersion,
} from "./build-binary.mjs";

test("the four release targets map to Bun targets", () => {
  assert.deepEqual(TARGETS, {
    "linux-x64": "bun-linux-x64",
    "linux-arm64": "bun-linux-arm64",
    "darwin-arm64": "bun-darwin-arm64",
    "darwin-x64": "bun-darwin-x64",
  });
});

test("the ad-hoc signature is forced: Bun already signs some darwin builds", () => {
  assert.deepEqual(codesignArgs("/o/pi-studio"), ["--force", "-s", "-", "/o/pi-studio"]);
});

test("parseArgs takes --target in both spellings and rejects the rest", () => {
  assert.deepEqual(parseArgs(["--target", "linux-x64"]), { target: "linux-x64" });
  assert.deepEqual(parseArgs(["--target=darwin-arm64"]), { target: "darwin-arm64" });
  assert.throws(() => parseArgs([]), /--target is required/);
  assert.throws(() => parseArgs(["--target", "win32-x64"]), /unknown target/);
  assert.throws(() => parseArgs(["--all"]), /unknown argument/);
});

test("parseArgs takes --version and --out-dir in both spellings, and only when given", () => {
  assert.deepEqual(parseArgs(["--target", "linux-x64", "--version", "0.0.9002"]), {
    target: "linux-x64",
    version: "0.0.9002",
  });
  assert.deepEqual(parseArgs(["--version=1.2.3", "--out-dir=/tmp/a=b", "--target=linux-arm64"]), {
    target: "linux-arm64",
    version: "1.2.3",
    outDir: "/tmp/a=b",
  });
  assert.deepEqual(parseArgs(["--out-dir", "/tmp/x", "--target", "linux-x64"]), {
    target: "linux-x64",
    outDir: "/tmp/x",
  });
  assert.throws(() => parseArgs(["--target", "linux-x64", "--version"]), /--version needs a value/);
  assert.throws(() => parseArgs(["--target", "linux-x64", "--version", "1.2"]), /not <major>/);
  assert.throws(() => parseArgs(["--target", "linux-x64", "--version", "v1.2.3"]), /not <major>/);
  assert.throws(() => parseArgs(["--version", "1.2.3"]), /--target is required/);
});

test("withVersion relabels the three compiled version modules for the callback only", () => {
  const root = mkdtempSync(join(tmpdir(), "build-binary-version-"));
  const files = ["server", "cli", "relay"].map((name) => {
    mkdirSync(join(root, "packages", name, "dist"), { recursive: true });
    const file = join(root, "packages", name, "dist", "version.generated.js");
    writeFileSync(file, `export const PACKAGE_VERSION = "0.0.130";\n//# sourceMappingURL=x.map`);
    return file;
  });
  const seen = withVersion(root, "0.0.9002", () => files.map((file) => readFileSync(file, "utf8")));
  assert.deepEqual(
    seen,
    files.map(() => versionModule("0.0.9002")),
  );
  assert.match(seen[0], /export const PACKAGE_VERSION = "0\.0\.9002";/);
  for (const file of files) {
    assert.equal(
      readFileSync(file, "utf8"),
      `export const PACKAGE_VERSION = "0.0.130";\n//# sourceMappingURL=x.map`,
    );
  }

  assert.throws(
    () =>
      withVersion(root, "0.0.9003", () => {
        throw new Error("compile failed");
      }),
    /compile failed/,
  );
  assert.match(readFileSync(files[1], "utf8"), /"0\.0\.130"/, "restored after a failed build");

  // A missing module fails before anything is written (nothing to restore, nothing left changed).
  rmSync(files[2]);
  assert.throws(() => withVersion(root, "0.0.9004", () => undefined), /ENOENT/);
  assert.match(readFileSync(files[0], "utf8"), /"0\.0\.130"/);
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
