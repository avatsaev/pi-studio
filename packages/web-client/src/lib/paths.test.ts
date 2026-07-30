import { describe, expect, it } from "vitest";
import { resolveWorkspacePath, dirOf, relativeToRoot } from "./paths.js";

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

describe("dirOf", () => {
  it("returns the parent of a nested path", () => {
    expect(dirOf("/repo/src/a.ts")).toBe("/repo/src");
  });

  it("returns the root for a top-level path", () => {
    expect(dirOf("/repo")).toBe("/");
  });
});

describe("relativeToRoot", () => {
  it("strips the root prefix and leading slash", () => {
    expect(relativeToRoot("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
  });

  it("returns the path unchanged when it isn't nested under root", () => {
    expect(relativeToRoot("/other/a.ts", "/repo")).toBe("/other/a.ts");
  });

  it("returns the path unchanged when root is empty", () => {
    expect(relativeToRoot("/repo/a.ts", "")).toBe("/repo/a.ts");
  });
});
