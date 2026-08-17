import { describe, expect, it } from "vitest";
import {
  toolBody,
  toolBadge,
  toolDiffStats,
  toolOutputLineCount,
  toolPrimaryField,
} from "./tool-mapping.js";

describe("toolBody", () => {
  it("returns [] for a tool with no input detail and no output", () => {
    expect(toolBody({ kind: "shell" })).toEqual([]);
  });

  it("returns only the input-detail section when there is no output", () => {
    expect(toolBody({ kind: "shell", command: "ls -la" })).toEqual([
      { kind: "code", text: "ls -la" },
    ]);
  });

  it("appends an output section after the input detail when both are present", () => {
    expect(toolBody({ kind: "shell", command: "ls -la", output: "total 0\ndrwxr-xr-x" })).toEqual([
      { kind: "code", text: "ls -la" },
      { kind: "code", text: "total 0\ndrwxr-xr-x" },
    ]);
  });

  it("returns only the output section when there is no input detail", () => {
    expect(toolBody({ kind: "shell", output: "total 0" })).toEqual([
      { kind: "code", text: "total 0" },
    ]);
  });

  it("renders the edit diff as a diff section, then output, never the raw diff text twice", () => {
    expect(toolBody({ kind: "edit", path: "/a.txt", diff: "+line", output: "ok" })).toEqual([
      { kind: "diff", patch: "+line" },
      { kind: "code", text: "ok" },
    ]);
  });

  it("falls back to the path code section for edit when there is no diff", () => {
    expect(toolBody({ kind: "edit", path: "/a.txt", output: "ok" })).toEqual([
      { kind: "code", text: "/a.txt" },
      { kind: "code", text: "ok" },
    ]);
  });
});

describe("toolBadge", () => {
  it("maps every ToolCallDetail kind to its documented label + tint token", () => {
    expect(toolBadge({ kind: "shell" })).toEqual({ label: "SHELL", token: "statusInfo" });
    expect(toolBadge({ kind: "read" })).toEqual({ label: "READ", token: "statusInfo" });
    expect(toolBadge({ kind: "write" })).toEqual({ label: "WRITE", token: "statusSuccess" });
    expect(toolBadge({ kind: "edit" })).toEqual({ label: "EDIT", token: "statusWarning" });
    expect(toolBadge({ kind: "search" })).toEqual({ label: "SEARCH", token: "statusInfo" });
    expect(toolBadge({ kind: "fetch" })).toEqual({ label: "FETCH", token: "statusInfo" });
    expect(toolBadge({ kind: "task" })).toEqual({ label: "TASK", token: "foregroundMuted" });
  });

  it("falls back to the task treatment for an unrecognized kind without throwing", () => {
    const unknown = { kind: "future-kind" } as unknown as Parameters<typeof toolBadge>[0];
    expect(toolBadge(unknown)).toEqual({ label: "TASK", token: "foregroundMuted" });
  });

  it("never returns the bare `success` token", () => {
    for (const kind of ["shell", "read", "write", "edit", "search", "fetch", "task"] as const) {
      expect(toolBadge({ kind }).token).not.toBe("success");
    }
  });
});

describe("toolDiffStats", () => {
  it("counts +/- body lines and ignores the +++/--- file headers", () => {
    const diff =
      "--- a.txt\n+++ a.txt\n@@ -1,2 +1,2 @@\n-old1\n-old2\n+new1\n+new2\n+new3\n unchanged";
    expect(toolDiffStats(diff)).toEqual({ added: 3, removed: 2 });
  });

  it("yields zeros for a diff with no changed lines, an empty string, and undefined", () => {
    expect(toolDiffStats("--- a.txt\n+++ a.txt\n@@ -1 +1 @@\n unchanged")).toEqual({
      added: 0,
      removed: 0,
    });
    expect(toolDiffStats("")).toEqual({ added: 0, removed: 0 });
    expect(toolDiffStats(undefined)).toEqual({ added: 0, removed: 0 });
  });
});

describe("toolOutputLineCount", () => {
  it("counts lines without a trailing-newline phantom line", () => {
    expect(toolOutputLineCount("a\nb")).toBe(2);
    expect(toolOutputLineCount("a\nb\n")).toBe(2);
  });

  it("treats empty output as zero lines and a single newline as one blank line", () => {
    expect(toolOutputLineCount("")).toBe(0);
    expect(toolOutputLineCount(undefined)).toBe(0);
    expect(toolOutputLineCount("\n")).toBe(1);
  });
});

describe("toolPrimaryField", () => {
  it("returns the full, untruncated value — not a basename or first line", () => {
    expect(toolPrimaryField({ kind: "read", path: "/a/very/long/nested/path/file.ts" })).toBe(
      "/a/very/long/nested/path/file.ts",
    );
    expect(toolPrimaryField({ kind: "shell", command: "echo one\necho two" })).toBe(
      "echo one\necho two",
    );
  });
});
