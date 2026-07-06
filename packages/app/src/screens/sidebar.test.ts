import { describe, it, expect } from "vitest";
import {
  projectDisplayName,
  prettyPath,
  deriveWorkspaceLabel,
  workspaceRowSubtitle,
  groupWorkspaces,
  type WorkspaceRow,
} from "./sidebar.js";

describe("projectDisplayName", () => {
  it("returns the trailing directory name for absolute paths", () => {
    expect(projectDisplayName("/home/me/DEV/edenred")).toBe("edenred");
    expect(projectDisplayName("/tmp")).toBe("tmp");
    expect(projectDisplayName("/home/me/DEV/edenred/edenchat")).toBe("edenchat");
  });

  it("handles trailing slashes", () => {
    expect(projectDisplayName("/home/me/DEV/edenred/")).toBe("edenred");
  });

  it("shows owner/repo for github remote ids", () => {
    expect(projectDisplayName("remote:github.com/getpaseo/paseo")).toBe("getpaseo/paseo");
  });

  it("returns ~ and / as-is", () => {
    expect(projectDisplayName("~")).toBe("~");
    expect(projectDisplayName("/")).toBe("/");
  });

  it("returns Ungrouped for empty/undefined/ungrouped", () => {
    expect(projectDisplayName(undefined)).toBe("Ungrouped");
    expect(projectDisplayName("")).toBe("Ungrouped");
    expect(projectDisplayName("ungrouped")).toBe("Ungrouped");
  });
});

describe("prettyPath", () => {
  it("collapses the home prefix to ~", () => {
    expect(prettyPath("/home/avatsaev/DEV/edenred")).toBe("~/DEV/edenred");
    expect(prettyPath("/Users/me/dev/paseo")).toBe("~/dev/paseo");
  });
  it("leaves non-home paths untouched", () => {
    expect(prettyPath("/tmp/x")).toBe("/tmp/x");
    expect(prettyPath(undefined)).toBe("");
  });
});

describe("deriveWorkspaceLabel", () => {
  it("prefers the agent title", () => {
    expect(deriveWorkspaceLabel({ title: "Fix login bug", cwd: "/home/me/app", agentId: "abc123def" })).toBe(
      "Fix login bug",
    );
  });
  it("falls back to branch, then project name, then short id", () => {
    expect(deriveWorkspaceLabel({ branch: "feat/x", cwd: "/home/me/app", agentId: "abc123def" })).toBe("feat/x");
    expect(deriveWorkspaceLabel({ cwd: "/home/me/DEV/edenred", agentId: "abc123def" })).toBe("edenred");
    expect(deriveWorkspaceLabel({ agentId: "abcdef123456" })).toBe("Session abcdef");
  });
  it("NEVER returns an absolute path as the label", () => {
    const label = deriveWorkspaceLabel({ cwd: "/home/me/DEV/edenred", agentId: "x" });
    expect(label).not.toContain("/");
    expect(deriveWorkspaceLabel({ cwd: "/tmp", agentId: "x" })).toBe("tmp");
  });
});

describe("workspaceRowSubtitle", () => {
  it("prefers model, then provider, else empty", () => {
    expect(workspaceRowSubtitle({ model: "gpt-5", provider: "pi" })).toBe("gpt-5");
    expect(workspaceRowSubtitle({ provider: "pi" })).toBe("pi");
    expect(workspaceRowSubtitle({})).toBe("");
  });
});

describe("groupWorkspaces", () => {
  const rows: WorkspaceRow[] = [
    { workspaceId: "a", label: "edenred", projectKey: "/home/me/DEV/edenred", lastActivityMs: 3 },
    { workspaceId: "b", label: "Fix bug", projectKey: "/home/me/DEV/edenred", lastActivityMs: 1 },
    { workspaceId: "c", label: "tmp", projectKey: "/tmp", lastActivityMs: 2 },
  ];

  it("groups by project with friendly section labels, preserving first-seen order", () => {
    const groups = groupWorkspaces(rows, "project");
    expect(groups.map((g) => g.label)).toEqual(["edenred", "tmp"]);
    expect(groups[0]!.key).toBe("/home/me/DEV/edenred");
    expect(groups[0]!.rows).toHaveLength(2);
    expect(groups[1]!.rows).toHaveLength(1);
  });

  it("section labels are never absolute paths", () => {
    for (const g of groupWorkspaces(rows, "project")) {
      expect(g.label.startsWith("/")).toBe(false);
    }
  });

  it("recent mode sorts by last activity desc", () => {
    const groups = groupWorkspaces(rows, "recent");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows.map((r) => r.workspaceId)).toEqual(["a", "c", "b"]);
  });
});
