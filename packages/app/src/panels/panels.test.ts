import { describe, expect, it } from "vitest";
import {
  buildNodes,
  checkPathSafety,
  checkWorkspaceAvailable,
  cycleSortMode,
  defaultDescriptor,
  explorerHeaderModel,
  flattenTree,
  INITIAL_EXPLORER_STATE,
  insertChildren,
  resolveConfirmClose,
  resolveExplorerViewState,
  resolveUploadTarget,
  rowActionsForEntry,
  setNodeLoading,
  sortEntries,
  toggleExpand,
  workspaceUnavailableMessage,
  type ExplorerEntry,
  type PanelRegistration,
} from "./index.js";
import { createWorkspaceTab } from "../workspace/tabs.js";

// ─── Panel contract ────────────────────────────────────────────────────────

describe("panel contract", () => {
  it("checkWorkspaceAvailable returns false when dir is undefined", () => {
    expect(checkWorkspaceAvailable(undefined)).toBe(false);
    expect(checkWorkspaceAvailable("/repo")).toBe(true);
  });

  it("workspaceUnavailableMessage returns a string", () => {
    expect(workspaceUnavailableMessage()).toContain("unavailable");
  });

  it("defaultDescriptor sets skeleton titleState while loading", () => {
    const tab = createWorkspaceTab({ kind: "file", path: "/repo/a.ts" });
    const d = defaultDescriptor("file", "file", "a.ts", tab, { loading: true });
    expect(d.titleState).toBe("skeleton");
    expect(d.label).toBe("");
    const ready = defaultDescriptor("file", "file", "a.ts", tab);
    expect(ready.titleState).toBe("ready");
    expect(ready.label).toBe("a.ts");
  });

  it("resolveConfirmClose returns the message when confirmClose is set", () => {
    const tab = createWorkspaceTab({ kind: "terminal", terminalId: "t1" });
    const reg: PanelRegistration = {
      kind: "terminal",
      componentName: "TerminalPanel",
      useDescriptor: () => ({ label: "Terminal", titleState: "ready", icon: "terminal" }),
      confirmClose: () => "Close terminal? Running processes may stop.",
    };
    const result = resolveConfirmClose(reg, tab);
    expect(result.shouldConfirm).toBe(true);
    if (result.shouldConfirm) expect(result.message).toContain("terminal");
  });

  it("resolveConfirmClose returns shouldConfirm=false when no confirmClose", () => {
    const tab = createWorkspaceTab({ kind: "file", path: "/a.ts" });
    const reg: PanelRegistration = {
      kind: "file",
      componentName: "FilePreviewPanel",
      useDescriptor: () => ({ label: "File", titleState: "ready", icon: "file" }),
    };
    expect(resolveConfirmClose(reg, tab).shouldConfirm).toBe(false);
  });
});

// ─── File explorer tree ────────────────────────────────────────────────────

const entries: ExplorerEntry[] = [
  { name: "src", path: "/repo/src", kind: "directory" },
  { name: "README.md", path: "/repo/README.md", kind: "file", size: 1200, modifiedMs: 3000 },
  { name: "package.json", path: "/repo/package.json", kind: "file", size: 800, modifiedMs: 2000 },
];

describe("file explorer tree", () => {
  it("sorts directories before files, then by mode", () => {
    const sorted = sortEntries(entries, "name");
    expect(sorted[0]!.kind).toBe("directory");
    expect(sorted[1]!.name).toBe("package.json");
  });

  it("size sort puts largest file first after dirs", () => {
    const sorted = sortEntries(entries, "size");
    expect(sorted[0]!.kind).toBe("directory");
    expect(sorted[1]!.size).toBe(1200);
  });

  it("cycleSortMode cycles name → modified → size → name", () => {
    expect(cycleSortMode("name")).toBe("modified");
    expect(cycleSortMode("modified")).toBe("size");
    expect(cycleSortMode("size")).toBe("name");
  });

  it("buildNodes creates nodes at correct depth and expanded state", () => {
    const expanded = new Set(["/repo/src"]);
    const nodes = buildNodes(entries, 0, expanded, "name");
    const dirNode = nodes.find((n) => n.entry.kind === "directory")!;
    expect(dirNode.depth).toBe(0);
    expect(dirNode.expanded).toBe(true);
    expect(nodes.find((n) => n.entry.path === "/repo/README.md")!.expanded).toBe(false);
  });

  it("flattenTree only recurses into expanded nodes with children", () => {
    const expanded = new Set(["/repo/src"]);
    const nodes = buildNodes(entries, 0, expanded, "name");
    const childEntry: ExplorerEntry = { name: "app.ts", path: "/repo/src/app.ts", kind: "file" };
    const childNodes = buildNodes([childEntry], 1, expanded, "name");
    const withChildren = insertChildren(nodes, "/repo/src", childNodes);
    const flat = flattenTree(withChildren);
    expect(flat.some((n) => n.entry.path === "/repo/src/app.ts")).toBe(true);
    expect(flat.length).toBe(4); // dir, app.ts child, README.md, package.json
  });

  it("toggleExpand adds/removes a path and setNodeLoading updates loading flag", () => {
    let state = { ...INITIAL_EXPLORER_STATE, root: buildNodes(entries, 0, new Set(), "name") };
    state = toggleExpand(state, "/repo/src");
    expect(state.expandedPaths.has("/repo/src")).toBe(true);
    state = toggleExpand(state, "/repo/src");
    expect(state.expandedPaths.has("/repo/src")).toBe(false);
    state.root = setNodeLoading(state.root, "/repo/src", true);
    expect(state.root.find((n) => n.entry.path === "/repo/src")?.loading).toBe(true);
  });

  it("resolveExplorerViewState returns correct kind for each state", () => {
    expect(resolveExplorerViewState(INITIAL_EXPLORER_STATE, false).kind).toBe("unavailable");
    expect(resolveExplorerViewState({ ...INITIAL_EXPLORER_STATE, loading: true }, true).kind).toBe("loading");
    expect(resolveExplorerViewState({ ...INITIAL_EXPLORER_STATE, error: "ENOENT" }, true).kind).toBe("error");
    expect(resolveExplorerViewState({ ...INITIAL_EXPLORER_STATE }, true).kind).toBe("empty");
    const withRoot = { ...INITIAL_EXPLORER_STATE, root: buildNodes(entries, 0, new Set(), "name") };
    expect(resolveExplorerViewState(withRoot, true).kind).toBe("tree");
  });
});

// ─── Row actions ──────────────────────────────────────────────────────────

describe("row actions and path safety", () => {
  it("rowActionsForEntry includes download only for files", () => {
    const fileActions = rowActionsForEntry({ name: "a.ts", path: "/repo/a.ts", kind: "file" });
    const dirActions = rowActionsForEntry({ name: "src", path: "/repo/src", kind: "directory" });
    expect(fileActions.some((a) => a.kind === "download")).toBe(true);
    expect(dirActions.some((a) => a.kind === "download")).toBe(false);
  });

  it("checkPathSafety rejects non-absolute and outside-workspace paths", () => {
    expect(checkPathSafety("relative/path", "/repo")).toMatchObject({ safe: false });
    expect(checkPathSafety("/other/path", "/repo")).toMatchObject({ safe: false });
    expect(checkPathSafety("/repo/src/app.ts", "/repo")).toMatchObject({ safe: true });
  });

  it("resolveUploadTarget produces correct destination path", () => {
    const target = resolveUploadTarget("/repo/src/", "new-file.ts");
    expect(target.destinationPath).toBe("/repo/src/new-file.ts");
  });

  it("explorerHeaderModel reflects state", () => {
    const header = explorerHeaderModel({ ...INITIAL_EXPLORER_STATE, sortMode: "size" }, true);
    expect(header.sortMode).toBe("size");
    expect(header.refreshing).toBe(true);
  });
});
