import { describe, expect, it } from "vitest";

import { CURRENT_VERSION, PACKAGE_NAME, compareVersions } from "./update-control.js";

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("0.0.12", "0.0.12")).toBe(0);
  });

  it("returns positive when the first version's patch is newer", () => {
    expect(compareVersions("0.0.13", "0.0.12")).toBeGreaterThan(0);
  });

  it("returns negative when the first version's patch is older", () => {
    expect(compareVersions("0.0.11", "0.0.12")).toBeLessThan(0);
  });

  it("compares minor and major segments, not just patch", () => {
    expect(compareVersions("0.1.0", "0.0.99")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.9.0", "1.0.0")).toBeLessThan(0);
  });

  it("treats a missing segment as 0", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.0")).toBeGreaterThan(0);
  });
});

describe("CURRENT_VERSION / PACKAGE_NAME", () => {
  it("reads the real package.json version, not a hardcoded placeholder", () => {
    expect(CURRENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CURRENT_VERSION).not.toBe("0.0.0");
  });

  it("targets the published CLI package", () => {
    expect(PACKAGE_NAME).toBe("@av-pi-studio/cli");
  });
});
