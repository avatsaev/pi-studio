import { describe, it, expect } from "vitest";
import { toWorkspaceDescriptor } from "./use-workspace-route.js";
import type { WorkspaceRecord } from "./use-nav-hooks.js";

function makeRecord(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    workspaceId: "a1",
    projectId: "dev-project",
    cwd: "/tmp/x",
    kind: "directory",
    displayName: "Fix bug",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("toWorkspaceDescriptor", () => {
  it("maps a WorkspaceRecord to a WorkspaceDescriptor with a single dev-mode agent id", () => {
    const record = makeRecord();
    expect(toWorkspaceDescriptor(record)).toEqual({
      workspaceId: "a1",
      name: "Fix bug",
      cwd: "/tmp/x",
      agentIds: ["a1"],
      projectId: "dev-project",
    });
  });
});
