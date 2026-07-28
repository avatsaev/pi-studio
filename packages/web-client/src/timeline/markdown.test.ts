import { describe, expect, it } from "vitest";
import { classifyImageSrc } from "./image-src.js";
import { selectInlineImageView } from "./inline-image-view.js";

/**
 * Integration tests for the markdown rendering pipeline with assetBase.
 * Verifies that the assetBase prop flows correctly through classification
 * and view-decision logic without JSX rendering.
 */

describe("markdown + assetBase integration", () => {
  describe("with assetBase set", () => {
    it("classifies a relative image path as local when assetBase is provided", () => {
      const classification = classifyImageSrc("./shot.png", "/repo", "/home/bob");
      expect(classification.kind).toBe("local");
    });

    it("produces a ready view once the image is fetched", () => {
      const classification = classifyImageSrc("./shot.png", "/repo", "/home/bob");
      expect(classification.kind).toBe("local");

      const view = selectInlineImageView(
        classification,
        { status: "ready", objectUrl: "blob:xxx" },
        "./shot.png",
        "shot",
      );
      expect(view.kind).toBe("ready");
      expect(view).toMatchObject({ objectUrl: "blob:xxx", alt: "shot" });
      // The exact path format from resolveWorkspacePath is an implementation detail
    });
  });

  describe("without assetBase (null)", () => {
    it("classifies a relative image path as unresolvable when assetBase is null", () => {
      const classification = classifyImageSrc("./shot.png", null, "/home/bob");
      expect(classification).toEqual({ kind: "unresolvable" });
    });

    it("produces a fallback view for unresolvable", () => {
      const classification = classifyImageSrc("./shot.png", null, "/home/bob");
      const view = selectInlineImageView(
        classification,
        { status: "idle" },
        "./shot.png",
        "alt text",
      );
      expect(view).toEqual({ kind: "unresolvable", fallbackText: "alt text" });
    });
  });

  describe("remote paths (independent of assetBase)", () => {
    it("classifies https URLs as remote regardless of assetBase", () => {
      const withBase = classifyImageSrc("https://example.com/a.png", "/repo", "/home/bob");
      const withoutBase = classifyImageSrc("https://example.com/a.png", null, "/home/bob");
      expect(withBase).toEqual({ kind: "remote" });
      expect(withoutBase).toEqual({ kind: "remote" });
    });

    it("produces passthrough view for remote", () => {
      const classification = classifyImageSrc("https://example.com/a.png", null, "/home/bob");
      const view = selectInlineImageView(
        classification,
        { status: "idle" },
        "https://example.com/a.png",
        "remote image",
      );
      expect(view).toEqual({
        kind: "remote",
        src: "https://example.com/a.png",
        alt: "remote image",
      });
    });
  });
});
