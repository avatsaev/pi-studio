import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SERVER_VERSION } from "./version.js";

describe("SERVER_VERSION", () => {
  it("matches packages/server/package.json, never the root package.json", () => {
    // Read live rather than hardcode a literal: this must keep passing across every version
    // bump (a hardcoded literal failed the 0.0.74 release CI).
    const serverPkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(SERVER_VERSION).toBe(serverPkg.version);
    // The root package.json has no "version" field at all — nothing to confuse this with.
    const rootPkg = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    );
    expect(rootPkg.version).toBeUndefined();
  });

  it("resolves correctly from the compiled dist/ layout too (skips if unbuilt)", () => {
    const distEntry = new URL("../dist/version.js", import.meta.url);
    if (!existsSync(distEntry)) return; // npm run build:server not run yet.
    const out = execFileSync(
      process.execPath,
      ["-e", `import(${JSON.stringify(distEntry.href)}).then(m => console.log(m.SERVER_VERSION))`],
      { encoding: "utf8" },
    ).trim();
    expect(out).toBe(SERVER_VERSION);
  });
});
