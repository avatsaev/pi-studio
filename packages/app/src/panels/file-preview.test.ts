import { describe, expect, it } from "vitest";
import { buildFilePreviewState, detectPreviewKind, filePreviewTabLabel, resolveReadTarget, shouldScrollToLine } from "./index.js";

describe("file preview panel", () => {
  it("detectPreviewKind identifies markdown / image / binary / code", () => {
    expect(detectPreviewKind("README.md")).toBe("markdown");
    expect(detectPreviewKind("photo.PNG")).toBe("image");
    expect(detectPreviewKind("archive.zip")).toBe("binary");
    expect(detectPreviewKind("src/app.ts")).toBe("code");
    expect(detectPreviewKind("data.json")).toBe("code");
  });

  it("resolveReadTarget handles workspace-relative, absolute, home-relative, outside-root", () => {
    expect(resolveReadTarget("src/app.ts", "/repo").kind).toBe("workspace-relative");
    expect(resolveReadTarget("~/notes.txt", "/repo").absolutePath).toContain("/home/notes.txt");
    expect(resolveReadTarget("/repo/src/a.ts", "/repo").kind).toBe("absolute-within-root");
    const outside = resolveReadTarget("/other/lib.ts", "/repo");
    expect(outside.kind).toBe("absolute-outside-root");
    if (outside.kind === "absolute-outside-root") expect(outside.derivedRoot).toBe("/other");
  });

  it("buildFilePreviewState returns error state on error", () => {
    const s = buildFilePreviewState({ path: "/repo/a.ts", error: "ENOENT" });
    expect(s.status).toBe("error");
    if (s.status === "error") expect(s.message).toBe("ENOENT");
  });

  it("code state includes language, line count, and line highlight for deep links", () => {
    const s = buildFilePreviewState({ path: "/repo/app.ts", content: "const x = 1;\nconst y = 2;", lineStart: 2, lineEnd: 2 });
    expect(s.status).toBe("ready");
    if (s.status === "ready" && s.kind === "code") {
      expect(s.language).toBe("ts");
      expect(s.lineCount).toBe(2);
      expect(s.lineHighlight).toEqual({ lineStart: 2, lineEnd: 2 });
      expect(shouldScrollToLine(s)).toBe(2);
    }
  });

  it("markdown state contains raw content", () => {
    const s = buildFilePreviewState({ path: "/repo/README.md", content: "# Hello" });
    expect(s.status).toBe("ready");
    if (s.status === "ready" && s.kind === "markdown") expect(s.content).toBe("# Hello");
  });

  it("binary state carries size", () => {
    const s = buildFilePreviewState({ path: "/repo/dist.zip", size: 4096 });
    expect(s.status).toBe("ready");
    if (s.status === "ready" && s.kind === "binary") expect(s.size).toBe(4096);
  });

  it("filePreviewTabLabel extracts the filename from the path", () => {
    expect(filePreviewTabLabel("/repo/src/app.ts")).toBe("app.ts");
    expect(filePreviewTabLabel("README.md")).toBe("README.md");
  });
});
