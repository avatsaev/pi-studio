import { describe, expect, it } from "vitest";
import { collapseInactiveWorkspaces, type WorkspaceGroup } from "./workspace-grouping.js";

function group(cwd: string): WorkspaceGroup {
  return { cwd, sessions: [] };
}

describe("collapseInactiveWorkspaces", () => {
  it("collapses every workspace except the active one", () => {
    const groups = [group("/repo-a"), group("/repo-b"), group("/repo-c")];
    expect(collapseInactiveWorkspaces(groups, "/repo-b")).toEqual(new Set(["/repo-a", "/repo-c"]));
  });

  it("collapses nothing when there is only the active workspace", () => {
    expect(collapseInactiveWorkspaces([group("/repo-a")], "/repo-a")).toEqual(new Set());
  });

  it("collapses every workspace when the active cwd matches none of them", () => {
    const groups = [group("/repo-a"), group("/repo-b")];
    expect(collapseInactiveWorkspaces(groups, "/repo-z")).toEqual(new Set(["/repo-a", "/repo-b"]));
  });
});
