import { describe, expect, it } from "vitest";
import { toolBody } from "./tool-mapping.js";

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
