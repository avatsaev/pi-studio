import { beforeEach, describe, expect, it } from "vitest";
import { useExplorerStore } from "./explorer-store.js";

beforeEach(() => {
  useExplorerStore.setState({
    rootPath: "",
    expanded: new Set(),
    expandedByRoot: new Map(),
    draft: null,
    renaming: null,
    selected: null,
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

  it("toggle collapses and re-expands the root row itself", () => {
    useExplorerStore.getState().setRoot("/home/dev/project");
    useExplorerStore.getState().toggle("/home/dev/project");
    expect(useExplorerStore.getState().expanded.has("/home/dev/project")).toBe(false);
    useExplorerStore.getState().toggle("/home/dev/project");
    expect(useExplorerStore.getState().expanded.has("/home/dev/project")).toBe(true);
  });

  it("a collapsed root survives a switch to another workspace and back", () => {
    useExplorerStore.getState().setRoot("/home/dev/project-a");
    useExplorerStore.getState().toggle("/home/dev/project-a");
    useExplorerStore.getState().setRoot("/home/dev/project-b");
    useExplorerStore.getState().setRoot("/home/dev/project-a");
    expect(useExplorerStore.getState().expanded.has("/home/dev/project-a")).toBe(false);
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

describe("explorer store — selected", () => {
  it("setSelected records the last-clicked row", () => {
    useExplorerStore.getState().setSelected({ path: "/home/dev/project/src", isDirectory: true });
    expect(useExplorerStore.getState().selected).toEqual({
      path: "/home/dev/project/src",
      isDirectory: true,
    });
  });

  it("setRoot clears the selection", () => {
    useExplorerStore.getState().setRoot("/home/dev/project-a");
    useExplorerStore.getState().setSelected({ path: "/home/dev/project-a/src", isDirectory: true });
    useExplorerStore.getState().setRoot("/home/dev/project-b");
    expect(useExplorerStore.getState().selected).toBeNull();
  });
});

describe("explorer store — repathAfterMove", () => {
  it("carries a moved expanded directory and its expanded descendants to the new prefix", () => {
    useExplorerStore.setState({
      rootPath: "/proj",
      expanded: new Set(["/proj", "/proj/a", "/proj/a/b", "/proj/a/b/c"]),
      expandedByRoot: new Map(),
      draft: null,
      selected: null,
    });
    useExplorerStore.getState().repathAfterMove("/proj/a", "/proj/x/a", "/proj/x");
    const { expanded } = useExplorerStore.getState();
    expect(expanded).toEqual(
      new Set(["/proj", "/proj/x", "/proj/x/a", "/proj/x/a/b", "/proj/x/a/b/c"]),
    );
  });

  it("leaves an expanded path unrelated to the move byte-identical", () => {
    useExplorerStore.setState({
      rootPath: "/proj",
      expanded: new Set(["/proj", "/proj/notes", "/proj/notes-old"]),
      expandedByRoot: new Map(),
      draft: null,
      selected: null,
    });
    useExplorerStore.getState().repathAfterMove("/proj/notes", "/proj/x/notes", "/proj/x");
    const { expanded } = useExplorerStore.getState();
    expect(expanded.has("/proj/notes-old")).toBe(true);
  });

  it("follows selected when it points at the moved item, keeping isDirectory", () => {
    useExplorerStore.setState({
      rootPath: "/proj",
      expanded: new Set(["/proj"]),
      expandedByRoot: new Map(),
      draft: null,
      selected: { path: "/proj/a/file.ts", isDirectory: false },
    });
    useExplorerStore.getState().repathAfterMove("/proj/a", "/proj/x/a", "/proj/x");
    expect(useExplorerStore.getState().selected).toEqual({
      path: "/proj/x/a/file.ts",
      isDirectory: false,
    });
  });

  it("leaves a null selection null", () => {
    useExplorerStore.setState({
      rootPath: "/proj",
      expanded: new Set(["/proj"]),
      expandedByRoot: new Map(),
      draft: null,
      selected: null,
    });
    useExplorerStore.getState().repathAfterMove("/proj/a", "/proj/x/a", "/proj/x");
    expect(useExplorerStore.getState().selected).toBeNull();
  });

  it("expands toParent even if it was collapsed before", () => {
    useExplorerStore.setState({
      rootPath: "/proj",
      expanded: new Set(["/proj"]),
      expandedByRoot: new Map(),
      draft: null,
      selected: null,
    });
    useExplorerStore.getState().repathAfterMove("/proj/a", "/proj/x/a", "/proj/x");
    expect(useExplorerStore.getState().expanded.has("/proj/x")).toBe(true);
  });

  it("keeps expandedByRoot for the current rootPath in sync with the new expanded set", () => {
    useExplorerStore.setState({
      rootPath: "/proj",
      expanded: new Set(["/proj", "/proj/a"]),
      expandedByRoot: new Map(),
      draft: null,
      selected: null,
    });
    useExplorerStore.getState().repathAfterMove("/proj/a", "/proj/x/a", "/proj/x");
    const s = useExplorerStore.getState();
    expect(s.expandedByRoot.get(s.rootPath)).toEqual(s.expanded);
  });

  it("leaves draft unchanged", () => {
    const draft = { parentPath: "/proj/a", kind: "file" as const };
    useExplorerStore.setState({
      rootPath: "/proj",
      expanded: new Set(["/proj"]),
      expandedByRoot: new Map(),
      draft,
      selected: null,
    });
    useExplorerStore.getState().repathAfterMove("/proj/a", "/proj/x/a", "/proj/x");
    expect(useExplorerStore.getState().draft).toBe(draft);
  });
});

describe("explorer store — rename", () => {
  it("startRename sets renaming and nulls any in-progress draft", () => {
    useExplorerStore.getState().setRoot("/home/dev/project");
    useExplorerStore.getState().startDraft("/home/dev/project/src", "file");
    useExplorerStore.getState().startRename("/home/dev/project/a.ts");
    const s = useExplorerStore.getState();
    expect(s.renaming).toBe("/home/dev/project/a.ts");
    expect(s.draft).toBeNull();
  });

  it("startDraft nulls renaming and sets the draft", () => {
    useExplorerStore.getState().setRoot("/home/dev/project");
    useExplorerStore.getState().startRename("/home/dev/project/a.ts");
    useExplorerStore.getState().startDraft("/home/dev/project/src", "directory");
    const s = useExplorerStore.getState();
    expect(s.renaming).toBeNull();
    expect(s.draft).toEqual({ parentPath: "/home/dev/project/src", kind: "directory" });
  });

  it("setRoot nulls both renaming and draft", () => {
    useExplorerStore.getState().setRoot("/home/dev/project-a");
    useExplorerStore.getState().startRename("/home/dev/project-a/a.ts");
    useExplorerStore.getState().setRoot("/home/dev/project-b");
    const s = useExplorerStore.getState();
    expect(s.renaming).toBeNull();
    expect(s.draft).toBeNull();
  });

  it("cancelRename nulls renaming and leaves draft, expanded, and selected untouched", () => {
    useExplorerStore.getState().setRoot("/home/dev/project");
    useExplorerStore.getState().setSelected({ path: "/home/dev/project/a.ts", isDirectory: false });
    useExplorerStore.getState().startRename("/home/dev/project/a.ts");
    const before = useExplorerStore.getState();
    useExplorerStore.getState().cancelRename();
    const after = useExplorerStore.getState();
    expect(after.renaming).toBeNull();
    expect(after.draft).toBe(before.draft);
    expect(after.expanded).toBe(before.expanded);
    expect(after.selected).toEqual({ path: "/home/dev/project/a.ts", isDirectory: false });
  });

  it("repathAfterMove nulls renaming while its existing rewrite behavior stays byte-identical", () => {
    useExplorerStore.setState({
      rootPath: "/proj",
      expanded: new Set(["/proj", "/proj/a", "/proj/a/b"]),
      expandedByRoot: new Map(),
      draft: null,
      selected: { path: "/proj/a", isDirectory: true },
      renaming: "/proj/a",
    });
    useExplorerStore.getState().repathAfterMove("/proj/a", "/proj/x/a", "/proj/x");
    const s = useExplorerStore.getState();
    expect(s.renaming).toBeNull();
    expect(s.expanded).toEqual(new Set(["/proj", "/proj/x", "/proj/x/a", "/proj/x/a/b"]));
    expect(s.selected).toEqual({ path: "/proj/x/a", isDirectory: true });
  });

  it("never holds both renaming and draft through an interleaved start sequence", () => {
    useExplorerStore.getState().setRoot("/proj");
    useExplorerStore.getState().startRename("/proj/a.ts");
    expect(useExplorerStore.getState().draft).toBeNull();
    useExplorerStore.getState().startDraft("/proj", "file");
    expect(useExplorerStore.getState().renaming).toBeNull();
    useExplorerStore.getState().startRename("/proj/b.ts");
    expect(useExplorerStore.getState().draft).toBeNull();
    useExplorerStore.getState().cancelRename();
    expect(useExplorerStore.getState().draft).toBeNull();
  });
});
