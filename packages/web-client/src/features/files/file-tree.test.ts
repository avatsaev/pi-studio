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
      [
        "/proj",
        listing([
          { name: "src", kind: "directory" },
          { name: "readme.md", kind: "file" },
        ]),
      ],
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
  it("puts a draft row for the root first, ahead of the root's own children", () => {
    const tree = new Map([
      [
        "/proj",
        listing([
          { name: "src", kind: "directory" },
          { name: "readme.md", kind: "file" },
        ]),
      ],
    ]);
    const draft = { parentPath: "/proj", kind: "file" as const };
    const rows = flattenTree("/proj", new Set(["/proj"]), tree, draft);
    expect(rows[0]).toEqual({
      kind: "draft",
      path: "/proj::draft",
      depth: 0,
      draftKind: "file",
      parentPath: "/proj",
    });
    expect(rows).toHaveLength(3);
  });

  it("puts a draft row ahead of the loading row for an expanded-but-unsettled directory", () => {
    const tree = new Map([["/proj", listing([{ name: "src", kind: "directory" }])]]);
    const draft = { parentPath: "/proj/src", kind: "directory" as const };
    const rows = flattenTree("/proj", new Set(["/proj", "/proj/src"]), tree, draft);
    expect(rows).toEqual([
      { kind: "directory", path: "/proj/src", name: "src", depth: 0, expanded: true },
      {
        kind: "draft",
        path: "/proj/src::draft",
        depth: 1,
        draftKind: "directory",
        parentPath: "/proj/src",
      },
      { kind: "loading", path: "/proj/src", depth: 1 },
    ]);
  });

  it("substitutes a rename row in place of a file row at the same index and depth", () => {
    const tree = new Map([
      [
        "/proj",
        listing([
          { name: "src", kind: "directory" },
          { name: "readme.md", kind: "file" },
        ]),
      ],
    ]);
    const rows = flattenTree("/proj", new Set(["/proj"]), tree, null, "/proj/readme.md");
    expect(rows).toEqual([
      { kind: "directory", path: "/proj/src", name: "src", depth: 0, expanded: false },
      {
        kind: "rename",
        path: "/proj/readme.md",
        name: "readme.md",
        depth: 0,
        isDirectory: false,
      },
    ]);
  });

  it("substitutes only the directory's own row when it is being renamed, leaving its expanded children in place", () => {
    const tree = new Map([
      ["/proj", listing([{ name: "src", kind: "directory" }])],
      ["/proj/src", listing([{ name: "index.ts", kind: "file" }])],
    ]);
    const rows = flattenTree("/proj", new Set(["/proj", "/proj/src"]), tree, null, "/proj/src");
    expect(rows).toEqual([
      { kind: "rename", path: "/proj/src", name: "src", depth: 0, isDirectory: true },
      { kind: "file", path: "/proj/src/index.ts", name: "index.ts", depth: 1 },
    ]);
  });

  it("is identical to passing null when renamingPath matches no visible row", () => {
    const tree = new Map([
      [
        "/proj",
        listing([
          { name: "src", kind: "directory" },
          { name: "readme.md", kind: "file" },
        ]),
      ],
    ]);
    const withoutRenaming = flattenTree("/proj", new Set(["/proj"]), tree, null, null);
    const withStalePath = flattenTree("/proj", new Set(["/proj"]), tree, null, "/proj/missing.md");
    expect(withStalePath).toEqual(withoutRenaming);
  });

  it("renders both a draft row and a rename row together without throwing", () => {
    const tree = new Map([
      [
        "/proj",
        listing([
          { name: "src", kind: "directory" },
          { name: "readme.md", kind: "file" },
        ]),
      ],
    ]);
    const draft = { parentPath: "/proj", kind: "file" as const };
    const rows = flattenTree("/proj", new Set(["/proj"]), tree, draft, "/proj/readme.md");
    expect(rows).toEqual([
      { kind: "draft", path: "/proj::draft", depth: 0, draftKind: "file", parentPath: "/proj" },
      { kind: "directory", path: "/proj/src", name: "src", depth: 0, expanded: false },
      {
        kind: "rename",
        path: "/proj/readme.md",
        name: "readme.md",
        depth: 0,
        isDirectory: false,
      },
    ]);
  });

  it("with renamingPath omitted, output is unchanged from the pre-rename behavior", () => {
    const tree = new Map([
      [
        "/proj",
        listing([
          { name: "src", kind: "directory" },
          { name: "readme.md", kind: "file" },
        ]),
      ],
    ]);
    const rows = flattenTree("/proj", new Set(["/proj"]), tree);
    expect(rows).toEqual([
      { kind: "directory", path: "/proj/src", name: "src", depth: 0, expanded: false },
      { kind: "file", path: "/proj/readme.md", name: "readme.md", depth: 0 },
    ]);
  });
});
