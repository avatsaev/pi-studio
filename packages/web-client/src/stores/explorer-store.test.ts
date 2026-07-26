import { beforeEach, describe, expect, it } from "vitest";
import { useExplorerStore } from "./explorer-store.js";

beforeEach(() => {
  useExplorerStore.setState({
    rootPath: "",
    expanded: new Set(),
    expandedByRoot: new Map(),
    draft: null,
  });
});

describe("explorer store — tree expansion", () => {
  it("setRoot seeds rootPath and auto-expands it", () => {
    useExplorerStore.getState().setRoot("/home/dev/project");
    const s = useExplorerStore.getState();
    expect(s.rootPath).toBe("/home/dev/project");
    expect(s.expanded.has("/home/dev/project")).toBe(true);
  });

  it("toggle expands then collapses a directory", () => {
    useExplorerStore.getState().setRoot("/home/dev/project");
    useExplorerStore.getState().toggle("/home/dev/project/src");
    expect(useExplorerStore.getState().expanded.has("/home/dev/project/src")).toBe(true);
    useExplorerStore.getState().toggle("/home/dev/project/src");
    expect(useExplorerStore.getState().expanded.has("/home/dev/project/src")).toBe(false);
  });

  it("toggle is a no-op on the root — it can never be collapsed", () => {
    useExplorerStore.getState().setRoot("/home/dev/project");
    useExplorerStore.getState().toggle("/home/dev/project");
    expect(useExplorerStore.getState().expanded.has("/home/dev/project")).toBe(true);
  });

  it("remembers a workspace's expanded set across a switch to another workspace and back", () => {
    const store = useExplorerStore.getState();
    store.setRoot("/home/dev/project-a");
    store.toggle("/home/dev/project-a/src");
    store.toggle("/home/dev/project-a/src/features");

    store.setRoot("/home/dev/project-b");
    expect(useExplorerStore.getState().expanded).toEqual(new Set(["/home/dev/project-b"]));

    useExplorerStore.getState().setRoot("/home/dev/project-a");
    const restored = useExplorerStore.getState().expanded;
    expect(restored.has("/home/dev/project-a")).toBe(true);
    expect(restored.has("/home/dev/project-a/src")).toBe(true);
    expect(restored.has("/home/dev/project-a/src/features")).toBe(true);
  });

  it("a fresh setRoot on a never-visited root starts with only the root expanded", () => {
    useExplorerStore.getState().setRoot("/home/dev/project-a");
    useExplorerStore.getState().toggle("/home/dev/project-a/src");
    useExplorerStore.getState().setRoot("/home/dev/project-c");
    expect(useExplorerStore.getState().expanded).toEqual(new Set(["/home/dev/project-c"]));
  });
});

describe("explorer store — draft", () => {
  it("startDraft sets draft and expands the target directory", () => {
    useExplorerStore.getState().setRoot("/home/dev/project");
    useExplorerStore.getState().startDraft("/home/dev/project/src", "directory");
    const s = useExplorerStore.getState();
    expect(s.draft).toEqual({ parentPath: "/home/dev/project/src", kind: "directory" });
    expect(s.expanded.has("/home/dev/project/src")).toBe(true);
  });

  it("cancelDraft clears the draft", () => {
    useExplorerStore.getState().setRoot("/home/dev/project");
    useExplorerStore.getState().startDraft("/home/dev/project/src", "file");
    useExplorerStore.getState().cancelDraft();
    expect(useExplorerStore.getState().draft).toBeNull();
  });

  it("setRoot clears any in-progress draft", () => {
    useExplorerStore.getState().setRoot("/home/dev/project-a");
    useExplorerStore.getState().startDraft("/home/dev/project-a/src", "file");
    useExplorerStore.getState().setRoot("/home/dev/project-b");
    expect(useExplorerStore.getState().draft).toBeNull();
  });
});
