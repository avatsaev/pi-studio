import { describe, expect, it } from "vitest";
import { LIVE_REFRESH_KINDS, watchTargetPath } from "./use-file-live-refresh.js";

describe("watchTargetPath", () => {
  it("returns an absolute path unchanged", () => {
    expect(watchTargetPath("/repo/src/a.ts", "/repo")).toBe("/repo/src/a.ts");
  });

  it("returns a ~-prefixed path unchanged", () => {
    expect(watchTargetPath("~/src/a.ts", "/repo")).toBe("~/src/a.ts");
  });

  it("joins a repo-relative path with the workspace cwd", () => {
    expect(watchTargetPath("src/a.ts", "/repo")).toBe("/repo/src/a.ts");
  });

  it("collapses a trailing slash on cwd before joining", () => {
    expect(watchTargetPath("src/a.ts", "/repo/")).toBe("/repo/src/a.ts");
  });

  it("returns null for an empty path", () => {
    expect(watchTargetPath("", "/repo")).toBeNull();
  });

  it("returns null for a relative path with no cwd", () => {
    expect(watchTargetPath("src/a.ts", "")).toBeNull();
  });
});

describe("LIVE_REFRESH_KINDS", () => {
  it("contains exactly text, markdown, and image", () => {
    expect(new Set(LIVE_REFRESH_KINDS)).toEqual(new Set(["text", "markdown", "image"]));
  });

  it("excludes video and binary", () => {
    expect(LIVE_REFRESH_KINDS.has("video")).toBe(false);
    expect(LIVE_REFRESH_KINDS.has("binary")).toBe(false);
  });
});
