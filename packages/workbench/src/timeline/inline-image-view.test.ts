import { describe, expect, it } from "vitest";
import { selectInlineImageView } from "./inline-image-view.js";

describe("selectInlineImageView", () => {
  describe("remote classification", () => {
    it("renders remote passthrough with src and alt", () => {
      const view = selectInlineImageView(
        { kind: "remote" },
        { status: "idle" },
        "https://example.com/a.png",
        "a screenshot",
      );
      expect(view).toEqual({
        kind: "remote",
        src: "https://example.com/a.png",
        alt: "a screenshot",
      });
    });

    it("renders remote passthrough with src but no alt", () => {
      const view = selectInlineImageView(
        { kind: "remote" },
        { status: "idle" },
        "https://example.com/a.png",
        undefined,
      );
      expect(view).toEqual({ kind: "remote", src: "https://example.com/a.png" });
    });

    it("never invokes the hook for remote; ignores any imageState", () => {
      const view = selectInlineImageView(
        { kind: "remote" },
        { status: "ready", objectUrl: "blob:xxx" },
        "https://example.com/a.png",
        "alt",
      );
      expect(view.kind).toBe("remote");
    });
  });

  describe("unresolvable classification", () => {
    it("renders text fallback with alt text", () => {
      const view = selectInlineImageView(
        { kind: "unresolvable" },
        { status: "idle" },
        "nope.png",
        "my image",
      );
      expect(view).toEqual({ kind: "unresolvable", fallbackText: "my image" });
    });

    it("falls back to src when alt is absent", () => {
      const view = selectInlineImageView(
        { kind: "unresolvable" },
        { status: "idle" },
        "nope.png",
        undefined,
      );
      expect(view).toEqual({ kind: "unresolvable", fallbackText: "nope.png" });
    });

    it("renders generic text when src is also missing", () => {
      const view = selectInlineImageView(
        { kind: "unresolvable" },
        { status: "idle" },
        undefined,
        undefined,
      );
      expect(view).toEqual({ kind: "unresolvable", fallbackText: "(image)" });
    });

    it("never invokes the hook for unresolvable; ignores any imageState", () => {
      const view = selectInlineImageView(
        { kind: "unresolvable" },
        { status: "ready", objectUrl: "blob:xxx" },
        "nope.png",
        "alt",
      );
      expect(view.kind).toBe("unresolvable");
    });
  });

  describe("local classification with loading/idle state", () => {
    it("renders skeleton for idle state", () => {
      const view = selectInlineImageView(
        { kind: "local", path: "/repo/shot.png" },
        { status: "idle" },
        "./shot.png",
        "screenshot",
      );
      expect(view).toEqual({ kind: "loading" });
    });

    it("renders skeleton for loading state", () => {
      const view = selectInlineImageView(
        { kind: "local", path: "/repo/shot.png" },
        { status: "loading" },
        "./shot.png",
        "screenshot",
      );
      expect(view).toEqual({ kind: "loading" });
    });
  });

  describe("local classification with ready state", () => {
    it("renders image with objectUrl, alt, and resolved path", () => {
      const view = selectInlineImageView(
        { kind: "local", path: "/repo/shot.png" },
        { status: "ready", objectUrl: "blob:abc123" },
        "./shot.png",
        "my screenshot",
      );
      expect(view).toEqual({
        kind: "ready",
        objectUrl: "blob:abc123",
        alt: "my screenshot",
        path: "/repo/shot.png",
      });
    });

    it("renders image with alt=undefined when markdown omits alt", () => {
      const view = selectInlineImageView(
        { kind: "local", path: "/repo/shot.png" },
        { status: "ready", objectUrl: "blob:abc123" },
        "./shot.png",
        undefined,
      );
      expect(view).toEqual({
        kind: "ready",
        objectUrl: "blob:abc123",
        alt: undefined,
        path: "/repo/shot.png",
      });
    });
  });

  describe("local classification with error state", () => {
    it("renders text fallback with alt text on download error", () => {
      const view = selectInlineImageView(
        { kind: "local", path: "/repo/shot.png" },
        { status: "error", message: "Not found" },
        "./shot.png",
        "my screenshot",
      );
      expect(view).toEqual({ kind: "error", fallbackText: "my screenshot" });
    });

    it("falls back to resolved path when alt is absent", () => {
      const view = selectInlineImageView(
        { kind: "local", path: "/repo/shot.png" },
        { status: "error", message: "Not found" },
        "./shot.png",
        undefined,
      );
      expect(view).toEqual({ kind: "error", fallbackText: "/repo/shot.png" });
    });

    it("renders generic text when path is also missing", () => {
      const view = selectInlineImageView(
        { kind: "local", path: "" },
        { status: "error", message: "Not found" },
        undefined,
        undefined,
      );
      expect(view).toEqual({ kind: "error", fallbackText: "(image)" });
    });
  });
});
