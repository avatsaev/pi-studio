import { describe, expect, it } from "vitest";
import { LIVE_REFRESH_KINDS } from "@pi-studio-ui/features/files/viewer-registry.js";

describe("LIVE_REFRESH_KINDS", () => {
  it("includes text, markdown, image, and html", () => {
    expect(LIVE_REFRESH_KINDS.has("text")).toBe(true);
    expect(LIVE_REFRESH_KINDS.has("markdown")).toBe(true);
    expect(LIVE_REFRESH_KINDS.has("image")).toBe(true);
    expect(LIVE_REFRESH_KINDS.has("html")).toBe(true);
  });

  it("excludes video and binary", () => {
    expect(LIVE_REFRESH_KINDS.has("video")).toBe(false);
    expect(LIVE_REFRESH_KINDS.has("binary")).toBe(false);
  });
});
