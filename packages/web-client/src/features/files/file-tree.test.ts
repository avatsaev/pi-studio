import { describe, expect, it } from "vitest";
import { flattenTree } from "./file-tree.js";
import type { ExplorerTreeEntry } from "@pi-studio-ui/hooks/use-explorer-tree.js";

function listing(entries: Array<{ name: string; kind: "file" | "directory" }>): ExplorerTreeEntry {
  return {
    listing: { path: "", entries },
    isLoading: false,
    isError: false,
    error: undefined,
  };
}

describe("flattenTree", () => {
  it("returns no rows for an empty root", () => {
    expect(flattenTree("", new Set(), new Map())).toEqual([]);
  });

  it("lists the root's children at depth 0 without a row for the root itself", () => {
    const tree = new Map([
      ["/proj", listing([{ name: "src", kind: "directory" }, { name: "readme.md", kind: "file" }])],
    ]);
    const rows = flattenTree("/proj", new Set(["/proj"]), tree);
    expect(rows).toEqual([
      { kind: "directory", path: "/proj/src", name: "src", depth: 0, expanded: false },
      { kind: "file", path: "/proj/readme.md", name: "readme.md", depth: 0 },
    ]);
  });

  it("inlines an expanded directory's children directly beneath it at depth + 1", () => {
    const tree = new Map([
      ["/proj", listing([{ name: "src", kind: "directory" }])],
      ["/proj/src", listing([{ name: "index.ts", kind: "file" }])],
    ]);
    const rows = flattenTree("/proj", new Set(["/proj", "/proj/src"]), tree);
    expect(rows).toEqual([
      { kind: "directory", path: "/proj/src", name: "src", depth: 0, expanded: true },
      { kind: "file", path: "/proj/src/index.ts", name: "index.ts", depth: 1 },
    ]);
  });

  it("renders a loading row for an expanded directory with no cached/settled query yet", () => {
    const tree = new Map([["/proj", listing([{ name: "src", kind: "directory" }])]]);
    const rows = flattenTree("/proj", new Set(["/proj", "/proj/src"]), tree);
    expect(rows).toEqual([
      { kind: "directory", path: "/proj/src", name: "src", depth: 0, expanded: true },
      { kind: "loading", path: "/proj/src", depth: 1 },
    ]);
  });

  it("renders an error row when an expanded directory's query failed", () => {
    const tree = new Map([
      ["/proj", listing([{ name: "src", kind: "directory" }])],
      [
        "/proj/src",
        { listing: undefined, isLoading: false, isError: true, error: new Error("denied") },
      ],
    ]);
    const rows = flattenTree("/proj", new Set(["/proj", "/proj/src"]), tree);
    expect(rows).toEqual([
      { kind: "directory", path: "/proj/src", name: "src", depth: 0, expanded: true },
      { kind: "error", path: "/proj/src", depth: 1, message: "denied" },
    ]);
  });

  it("does not recurse into a collapsed directory even if its listing is cached", () => {
    const tree = new Map([
      ["/proj", listing([{ name: "src", kind: "directory" }])],
      ["/proj/src", listing([{ name: "index.ts", kind: "file" }])],
    ]);
    const rows = flattenTree("/proj", new Set(["/proj"]), tree);
    expect(rows).toEqual([
      { kind: "directory", path: "/proj/src", name: "src", depth: 0, expanded: false },
    ]);
  });
});
