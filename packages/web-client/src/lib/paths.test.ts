import { describe, expect, it } from "vitest";
import { resolveWorkspacePath, dirOf, relativeToRoot, collapseDotSegments } from "./paths.js";

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

describe("collapseDotSegments", () => {
  it("collapses . segments", () => {
    expect(collapseDotSegments("/repo/./notes.md")).toBe("/repo/notes.md");
  });

  it("collapses multiple . segments", () => {
    expect(collapseDotSegments("/repo/./src/./file.ts")).toBe("/repo/src/file.ts");
  });

  it("collapses .. segments to parent", () => {
    expect(collapseDotSegments("/repo/sub/../notes.md")).toBe("/repo/notes.md");
  });

  it("collapses multiple .. segments", () => {
    expect(collapseDotSegments("/repo/a/b/../../notes.md")).toBe("/repo/notes.md");
  });

  it("handles mixed . and .. segments", () => {
    expect(collapseDotSegments("/repo/a/./b/../c/./d")).toBe("/repo/a/c/d");
  });

  it("clamps .. at root", () => {
    expect(collapseDotSegments("/../notes.md")).toBe("/notes.md");
  });

  it("clamps multiple .. at root", () => {
    expect(collapseDotSegments("/../../notes.md")).toBe("/notes.md");
  });

  it("preserves double slashes in first segment only (from leading /)", () => {
    // Leading / creates empty first segment; /repo//file collapses to /repo/file
    expect(collapseDotSegments("/repo//file.ts")).toBe("/repo/file.ts");
  });

  it("returns unchanged path for non-absolute path", () => {
    // Non-absolute paths are returned unchanged per contract
    expect(collapseDotSegments("repo/notes.md")).toBe("repo/notes.md");
  });

  it("returns root unchanged", () => {
    expect(collapseDotSegments("/")).toBe("/");
  });

  it("handles complex nested case from task acceptance criteria", () => {
    expect(collapseDotSegments("/repo/x/../notes.md")).toBe("/repo/notes.md");
  });

  it("handles task acceptance: /repo/a with ../x/../notes.md", () => {
    // This simulates resolveWorkspacePath("../x/../notes.md", "/repo/a")
    // which produces "/repo/a/../x/../notes.md"
    expect(collapseDotSegments("/repo/a/../x/../notes.md")).toBe("/repo/notes.md");
  });
});
