import { beforeEach, describe, expect, it } from "vitest";
import { useExplorerStore } from "./explorer-store.js";

beforeEach(() => {
  useExplorerStore.setState({ currentPath: "", rootPath: "" });
});

describe("explorer store — workspace-root navigation clamp", () => {
  it("setRoot seeds both rootPath and currentPath to the same value", () => {
    useExplorerStore.getState().setRoot("/home/dev/project");
    const s = useExplorerStore.getState();
    expect(s.rootPath).toBe("/home/dev/project");
    expect(s.currentPath).toBe("/home/dev/project");
  });

  it("goUp walks up a subdirectory back toward the root", () => {
    useExplorerStore.getState().setRoot("/home/dev/project");
    useExplorerStore.getState().setPath("/home/dev/project/src/features");
    useExplorerStore.getState().goUp();
    expect(useExplorerStore.getState().currentPath).toBe("/home/dev/project/src");
  });

  it("goUp never crosses above rootPath, even from directly one level below it", () => {
    useExplorerStore.getState().setRoot("/home/dev/project");
    useExplorerStore.getState().setPath("/home/dev/project/src");
    useExplorerStore.getState().goUp();
    expect(useExplorerStore.getState().currentPath).toBe("/home/dev/project");
  });

  it("goUp is a no-op once already at rootPath", () => {
    useExplorerStore.getState().setRoot("/home/dev/project");
    useExplorerStore.getState().goUp();
    expect(useExplorerStore.getState().currentPath).toBe("/home/dev/project");
  });

  it("goUp is a no-op when no root has been seeded yet", () => {
    useExplorerStore.getState().setPath("/home/dev/project/src");
    useExplorerStore.getState().goUp();
    expect(useExplorerStore.getState().currentPath).toBe("/home/dev/project/src");
  });
});
