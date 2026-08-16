import { describe, expect, it } from "vitest";
import { flattenTree, rowKey } from "./file-tree.js";
import type { ExplorerTreeEntry } from "@pi-studio-ui/hooks/use-explorer-tree.js";

function listing(entries: Array<{ name: string; kind: "file" | "directory" }>): ExplorerTreeEntry {
  return {
    listing: { path: "", entries },
    isLoading: false,
    isError: false,
    error: undefined,
  };
}

const ROOT_ROW = {
  kind: "directory",
  path: "/proj",
  name: "proj",
  depth: 0,
  expanded: true,
} as const;

describe("flattenTree", () => {
  it("returns no rows for an empty root", () => {
    expect(flattenTree("", new Set(), new Map())).toEqual([]);
  });

  it("names the root row after the cwd's basename, falling back to the path itself", () => {
    expect(flattenTree("/", new Set(), new Map())[0]).toEqual({
      kind: "directory",
      path: "/",
      name: "/",
      depth: 0,
      expanded: false,
    });
  });

  it("renders only the root row, collapsed, when the root is not expanded", () => {
    const tree = new Map([["/proj", listing([{ name: "src", kind: "directory" }])]]);
    expect(flattenTree("/proj", new Set(), tree)).toEqual([{ ...ROOT_ROW, expanded: false }]);
  });

  it("lists the root's children at depth 1 beneath a row for the root itself", () => {
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
      ROOT_ROW,
      { kind: "directory", path: "/proj/src", name: "src", depth: 1, expanded: false },
      { kind: "file", path: "/proj/readme.md", name: "readme.md", depth: 1 },
    ]);
  });

  it("inlines an expanded directory's children directly beneath it at depth + 1", () => {
    const tree = new Map([
      ["/proj", listing([{ name: "src", kind: "directory" }])],
      ["/proj/src", listing([{ name: "index.ts", kind: "file" }])],
    ]);
    const rows = flattenTree("/proj", new Set(["/proj", "/proj/src"]), tree);
    expect(rows).toEqual([
      ROOT_ROW,
      { kind: "directory", path: "/proj/src", name: "src", depth: 1, expanded: true },
      { kind: "file", path: "/proj/src/index.ts", name: "index.ts", depth: 2 },
    ]);
  });

  it("renders a loading row for an expanded directory with no cached/settled query yet", () => {
    const tree = new Map([["/proj", listing([{ name: "src", kind: "directory" }])]]);
    const rows = flattenTree("/proj", new Set(["/proj", "/proj/src"]), tree);
    expect(rows).toEqual([
      ROOT_ROW,
      { kind: "directory", path: "/proj/src", name: "src", depth: 1, expanded: true },
      { kind: "loading", path: "/proj/src", depth: 2 },
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
      ROOT_ROW,
      { kind: "directory", path: "/proj/src", name: "src", depth: 1, expanded: true },
      { kind: "error", path: "/proj/src", depth: 2, message: "denied" },
    ]);
  });

  it("does not recurse into a collapsed directory even if its listing is cached", () => {
    const tree = new Map([
      ["/proj", listing([{ name: "src", kind: "directory" }])],
      ["/proj/src", listing([{ name: "index.ts", kind: "file" }])],
    ]);
    const rows = flattenTree("/proj", new Set(["/proj"]), tree);
    expect(rows).toEqual([
      ROOT_ROW,
      { kind: "directory", path: "/proj/src", name: "src", depth: 1, expanded: false },
    ]);
  });

  it("puts a draft row for the root directly under the root row, ahead of its children", () => {
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
    expect(rows[0]).toEqual(ROOT_ROW);
    expect(rows[1]).toEqual({
      kind: "draft",
      path: "/proj::draft",
      depth: 1,
      draftKind: "file",
      parentPath: "/proj",
    });
    expect(rows).toHaveLength(4);
  });

  it("puts a draft row ahead of the loading row for an expanded-but-unsettled directory", () => {
    const tree = new Map([["/proj", listing([{ name: "src", kind: "directory" }])]]);
    const draft = { parentPath: "/proj/src", kind: "directory" as const };
    const rows = flattenTree("/proj", new Set(["/proj", "/proj/src"]), tree, draft);
    expect(rows).toEqual([
      ROOT_ROW,
      { kind: "directory", path: "/proj/src", name: "src", depth: 1, expanded: true },
      {
        kind: "draft",
        path: "/proj/src::draft",
        depth: 2,
        draftKind: "directory",
        parentPath: "/proj/src",
      },
      { kind: "loading", path: "/proj/src", depth: 2 },
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
      ROOT_ROW,
      { kind: "directory", path: "/proj/src", name: "src", depth: 1, expanded: false },
      {
        kind: "rename",
        path: "/proj/readme.md",
        name: "readme.md",
        depth: 1,
        isDirectory: false,
      },
    ]);
  });

  it("never substitutes a rename row for the root, even when renamingPath is the root", () => {
    const tree = new Map([["/proj", listing([{ name: "readme.md", kind: "file" }])]]);
    const rows = flattenTree("/proj", new Set(["/proj"]), tree, null, "/proj");
    expect(rows).toEqual([
      ROOT_ROW,
      { kind: "file", path: "/proj/readme.md", name: "readme.md", depth: 1 },
    ]);
  });

  it("substitutes only the directory's own row when it is being renamed, leaving its expanded children in place", () => {
    const tree = new Map([
      ["/proj", listing([{ name: "src", kind: "directory" }])],
      ["/proj/src", listing([{ name: "index.ts", kind: "file" }])],
    ]);
    const rows = flattenTree("/proj", new Set(["/proj", "/proj/src"]), tree, null, "/proj/src");
    expect(rows).toEqual([
      ROOT_ROW,
      { kind: "rename", path: "/proj/src", name: "src", depth: 1, isDirectory: true },
      { kind: "file", path: "/proj/src/index.ts", name: "index.ts", depth: 2 },
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
      ROOT_ROW,
      { kind: "draft", path: "/proj::draft", depth: 1, draftKind: "file", parentPath: "/proj" },
      { kind: "directory", path: "/proj/src", name: "src", depth: 1, expanded: false },
      {
        kind: "rename",
        path: "/proj/readme.md",
        name: "readme.md",
        depth: 1,
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
      ROOT_ROW,
      { kind: "directory", path: "/proj/src", name: "src", depth: 1, expanded: false },
      { kind: "file", path: "/proj/readme.md", name: "readme.md", depth: 1 },
    ]);
  });
});

describe("rowKey", () => {
  it("separates the root row from the loading row for the root's own unsettled listing", () => {
    // Both rows carry path "/proj" — the duplicate-key case that orphaned a DOM node and left
    // ghost text stacked on the root folder name.
    const rows = flattenTree("/proj", new Set(["/proj"]), new Map());
    expect(rows).toEqual([ROOT_ROW, { kind: "loading", path: "/proj", depth: 1 }]);
    expect(rows.map(rowKey)).toEqual(["directory:/proj", "loading:/proj"]);
  });

  it("separates the root row from an error row for the root's own failed listing", () => {
    const tree = new Map([
      ["/proj", { listing: undefined, isLoading: false, isError: true, error: new Error("nope") }],
    ]);
    const keys = flattenTree("/proj", new Set(["/proj"]), tree).map(rowKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is unique across every row kind rendered at once", () => {
    const tree = new Map([
      [
        "/proj",
        listing([
          { name: "src", kind: "directory" },
          { name: "readme.md", kind: "file" },
        ]),
      ],
    ]);
    const rows = flattenTree(
      "/proj",
      new Set(["/proj", "/proj/src"]),
      tree,
      { parentPath: "/proj", kind: "file" },
      "/proj/readme.md",
    );
    expect(rows.map((r) => r.kind)).toEqual([
      "directory",
      "draft",
      "directory",
      "loading",
      "rename",
    ]);
    const keys = rows.map(rowKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
