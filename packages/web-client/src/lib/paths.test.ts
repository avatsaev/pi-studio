import { describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "./paths.js";

describe("resolveWorkspacePath", () => {
  it("returns an absolute path unchanged", () => {
    expect(resolveWorkspacePath("/repo/src/a.ts", "/repo")).toBe("/repo/src/a.ts");
  });

  it("returns a ~-prefixed path unchanged", () => {
    expect(resolveWorkspacePath("~/src/a.ts", "/repo")).toBe("~/src/a.ts");
  });

  it("joins a repo-relative path with the workspace base", () => {
    expect(resolveWorkspacePath("src/a.ts", "/repo")).toBe("/repo/src/a.ts");
  });

  it("collapses a trailing slash on base before joining", () => {
    expect(resolveWorkspacePath("src/a.ts", "/repo/")).toBe("/repo/src/a.ts");
  });

  it("returns null for an empty path", () => {
    expect(resolveWorkspacePath("", "/repo")).toBeNull();
  });

  it("returns null for a relative path with no base", () => {
    expect(resolveWorkspacePath("src/a.ts", "")).toBeNull();
  });
});
