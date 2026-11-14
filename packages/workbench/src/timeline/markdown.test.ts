import { describe, expect, it } from "vitest";
import { classifyImageSrc } from "./image-src.js";
import { classifyFileLinkSrc } from "./file-link-src.js";
import { selectInlineImageView } from "./inline-image-view.js";
import { resolveFileOpenTarget } from "./file-open-target.js";

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
      if (classification.kind === "local") {
        expect(classification.path).toBe("/repo/shot.png"); // normalized
      }
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

describe("converged click-to-open dispatch (task-003)", () => {
  describe("FileLink: classification + owningPaneId + workspaceCwd -> openFileTab args", () => {
    it("a resolvable relative link opens with the owning tab's workspaceCwd and pane", () => {
      const classification = classifyFileLinkSrc("./notes.md", "/repo", null);
      expect(classification).toEqual({ kind: "local", path: "/repo/notes.md" });
      if (classification.kind !== "local") throw new Error("expected local");
      const target = resolveFileOpenTarget("/repo", "pane-1", "/work");
      expect({ path: classification.path, ...target }).toEqual({
        path: "/repo/notes.md",
        workspaceCwd: "/work",
        targetPaneId: "pane-1",
      });
    });

    it("an absolute link opens targeting a null owningPaneId as undefined (global-focus fallback)", () => {
      const classification = classifyFileLinkSrc("/etc/hosts", "/repo", null);
      expect(classification).toEqual({ kind: "local", path: "/etc/hosts" });
      const target = resolveFileOpenTarget("/repo", null, "/work");
      expect(target).toEqual({ workspaceCwd: "/work", targetPaneId: undefined });
    });

    it("a ~-prefixed link resolves against a known home dir", () => {
      const classification = classifyFileLinkSrc("~/notes.md", "/repo", "/home/bob");
      expect(classification).toEqual({ kind: "local", path: "/home/bob/notes.md" });
    });

    it("an external link is never intercepted — no dispatch target computed", () => {
      expect(classifyFileLinkSrc("https://example.com", "/repo", null)).toEqual({
        kind: "external",
      });
    });

    it("an in-page anchor is never intercepted, even with a valid asset base", () => {
      expect(classifyFileLinkSrc("#section", "/repo", "/home/bob")).toEqual({ kind: "external" });
    });

    it("a relative link with no asset base is external (unresolvable)", () => {
      expect(classifyFileLinkSrc("./notes.md", null, null)).toEqual({ kind: "external" });
    });
  });

  describe("InlineImage regression: the same target resolution the pre-existing click-to-open now uses", () => {
    it("a resolved local image opens with the owning tab's workspaceCwd and pane, not the assetBase approximation", () => {
      const classification = classifyImageSrc("./shot.png", "/repo", "/home/bob");
      expect(classification).toEqual({ kind: "local", path: "/repo/shot.png" });
      const target = resolveFileOpenTarget("/repo", "pane-2", "/work");
      expect(target).toEqual({ workspaceCwd: "/work", targetPaneId: "pane-2" });
    });

    it("falls back to assetBase || '~' only when no owning tab's workspaceCwd is known", () => {
      expect(resolveFileOpenTarget("/repo", "pane-2", null)).toEqual({
        workspaceCwd: "/repo",
        targetPaneId: "pane-2",
      });
      expect(resolveFileOpenTarget(null, "pane-2", null)).toEqual({
        workspaceCwd: "~",
        targetPaneId: "pane-2",
      });
    });

    it("a tab not yet placed in any pane (owningPaneId null) falls back to undefined, never throwing", () => {
      expect(resolveFileOpenTarget("/repo", null, "/work")).toEqual({
        workspaceCwd: "/work",
        targetPaneId: undefined,
      });
    });
  });
});
