import { describe, expect, it } from "vitest";
import { resolveFileOpenTarget } from "./file-open-target.js";

describe("resolveFileOpenTarget", () => {
  it("prefers a real workspaceCwd over the assetBase fallback", () => {
    expect(resolveFileOpenTarget("/repo", "pane-1", "/work")).toEqual({
      workspaceCwd: "/work",
      targetPaneId: "pane-1",
    });
  });

  it("falls back to assetBase when workspaceCwd is null (markdown outside any tab)", () => {
    expect(resolveFileOpenTarget("/repo", "pane-1", null)).toEqual({
      workspaceCwd: "/repo",
      targetPaneId: "pane-1",
    });
  });

  it("falls back to ~ when neither workspaceCwd nor assetBase is known", () => {
    expect(resolveFileOpenTarget(null, "pane-1", null)).toEqual({
      workspaceCwd: "~",
      targetPaneId: "pane-1",
    });
  });

  it("converts a null owningPaneId to undefined, matching openFileTab's targetPaneId contract", () => {
    expect(resolveFileOpenTarget("/repo", null, "/work")).toEqual({
      workspaceCwd: "/work",
      targetPaneId: undefined,
    });
  });
});
