import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CURRENT_VERSION } from "./update-control.js";
import { PACKAGE_VERSION } from "./version.generated.js";

describe("generated version module", () => {
  it("equals packages/cli/package.json (run scripts/gen-version.mjs after a version bump)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(PACKAGE_VERSION).toBe(pkg.version);
    expect(CURRENT_VERSION).toBe(pkg.version);
  });
});
