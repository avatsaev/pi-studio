import { describe, expect, it } from "vitest";
import { LIVE_REFRESH_KINDS } from "./use-file-live-refresh.js";

describe("LIVE_REFRESH_KINDS", () => {
  it("contains exactly text, markdown, and image", () => {
    expect(new Set(LIVE_REFRESH_KINDS)).toEqual(new Set(["text", "markdown", "image"]));
  });

  it("excludes video and binary", () => {
    expect(LIVE_REFRESH_KINDS.has("video")).toBe(false);
    expect(LIVE_REFRESH_KINDS.has("binary")).toBe(false);
  });
});
