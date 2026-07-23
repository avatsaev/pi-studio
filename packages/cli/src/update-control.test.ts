import { describe, expect, it } from "vitest";

import {
  CURRENT_VERSION,
  PACKAGE_NAME,
  compareVersions,
  installWithStaleStagingRetry,
  staleStagingDirFrom,
} from "./update-control.js";

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

describe("staleStagingDirFrom", () => {
  it("extracts the blocking staging directory from npm's real ENOTEMPTY message", () => {
    const message =
      "ENOTEMPTY: directory not empty, rename " +
      "'/home/u20/ssaiev/.nvm/versions/node/v22.22.1/lib/node_modules/@av-pi-studio/cli' -> " +
      "'/home/u20/ssaiev/.nvm/versions/node/v22.22.1/lib/node_modules/@av-pi-studio/.cli-4cDx8kZc'";
    expect(staleStagingDirFrom(message)).toBe(
      "/home/u20/ssaiev/.nvm/versions/node/v22.22.1/lib/node_modules/@av-pi-studio/.cli-4cDx8kZc",
    );
  });

  it("returns null for unrelated errors", () => {
    expect(staleStagingDirFrom("EACCES: permission denied")).toBeNull();
    expect(staleStagingDirFrom("network timeout")).toBeNull();
  });
});

describe("installWithStaleStagingRetry", () => {
  it("succeeds immediately when install doesn't fail", async () => {
    const removed: string[] = [];
    await installWithStaleStagingRetry(
      async () => {},
      async (path) => removed.push(path),
    );
    expect(removed).toEqual([]);
  });

  it("removes the stale staging dir and retries once on an ENOTEMPTY collision", async () => {
    const removed: string[] = [];
    let attempts = 0;
    await installWithStaleStagingRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error(
            "ENOTEMPTY: directory not empty, rename '/pkg/cli' -> '/pkg/.cli-abc123'",
          );
        }
      },
      async (path) => removed.push(path),
    );
    expect(attempts).toBe(2);
    expect(removed).toEqual(["/pkg/.cli-abc123"]);
  });

  it("gives up and rethrows after exhausting retries on a persistent collision", async () => {
    const removed: string[] = [];
    let attempts = 0;
    await expect(
      installWithStaleStagingRetry(
        async () => {
          attempts += 1;
          throw new Error(
            "ENOTEMPTY: directory not empty, rename '/pkg/cli' -> '/pkg/.cli-abc123'",
          );
        },
        async (path) => removed.push(path),
        2,
      ),
    ).rejects.toThrow("ENOTEMPTY");
    expect(attempts).toBe(3); // initial + 2 retries
    expect(removed).toEqual(["/pkg/.cli-abc123", "/pkg/.cli-abc123"]);
  });

  it("does not retry a non-ENOTEMPTY failure", async () => {
    const removed: string[] = [];
    let attempts = 0;
    await expect(
      installWithStaleStagingRetry(
        async () => {
          attempts += 1;
          throw new Error("EACCES: permission denied");
        },
        async (path) => removed.push(path),
      ),
    ).rejects.toThrow("EACCES");
    expect(attempts).toBe(1);
    expect(removed).toEqual([]);
  });
});
