import { describe, expect, it } from "vitest";

import { CURRENT_VERSION, PACKAGE_NAME, defaultUpdateRuntime } from "./update-control.js";

// The engine's own tests (version comparison, ENOTEMPTY retry) live in
// packages/server/src/update/npm.test.ts.

describe("CURRENT_VERSION / PACKAGE_NAME", () => {
  it("reads the real package.json version, not a hardcoded placeholder", () => {
    expect(CURRENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CURRENT_VERSION).not.toBe("0.0.0");
  });

  it("targets the published CLI package", () => {
    expect(PACKAGE_NAME).toBe("@av-pi-studio/cli");
  });
});

describe("defaultUpdateRuntime", () => {
  it("wires the server engine's npm lookup and install", () => {
    const runtime = defaultUpdateRuntime();
    expect(typeof runtime.getLatestVersion).toBe("function");
    expect(typeof runtime.installGlobal).toBe("function");
  });
});
