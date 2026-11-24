import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PACKAGE_VERSION } from "./version.generated.js";

describe("generated version module", () => {
  it("equals packages/relay/package.json (run scripts/gen-version.mjs after a version bump)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(PACKAGE_VERSION).toBe(pkg.version);
  });
});
