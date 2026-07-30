import { describe, expect, it } from "vitest";
import { resolveMoveTarget } from "./move-target.js";

describe("resolveMoveTarget", () => {
  it("resolves a file dropped on a directory row to that directory + the joined destination", () => {
    const result = resolveMoveTarget(
      "/proj/note.txt",
      { kind: "directory", path: "/proj/src" },
      "/proj",
    );
    expect(result).toEqual({
      destinationDir: "/proj/src",
      destination: "/proj/src/note.txt",
    });
  });

  it("resolves a file dropped on a file row to that file's parent directory", () => {
    const result = resolveMoveTarget(
      "/proj/note.txt",
      { kind: "file", path: "/proj/src/other.txt" },
      "/proj",
    );
    expect(result).toEqual({
      destinationDir: "/proj/src",
      destination: "/proj/src/note.txt",
    });
  });

  it("returns null when the resolved directory already contains the source", () => {
    const result = resolveMoveTarget(
      "/proj/src/note.txt",
      { kind: "file", path: "/proj/src/other.txt" },
      "/proj",
    );
    expect(result).toBeNull();
  });

  it("returns null for a directory dropped on itself", () => {
    const result = resolveMoveTarget(
      "/proj/src",
      { kind: "directory", path: "/proj/src" },
      "/proj",
    );
    expect(result).toBeNull();
  });

  it("returns null for a directory dropped on a row inside itself", () => {
    const result = resolveMoveTarget(
      "/proj/src",
      { kind: "directory", path: "/proj/src/sub" },
      "/proj",
    );
    expect(result).toBeNull();
  });

  it("returns null for a row kind other than file/directory", () => {
    const result = resolveMoveTarget(
      "/proj/note.txt",
      { kind: "loading", path: "/proj/src" },
      "/proj",
    );
    expect(result).toBeNull();
  });

  it("returns null when the resolved directory is outside rootPath", () => {
    const result = resolveMoveTarget(
      "/proj/note.txt",
      { kind: "directory", path: "/other" },
      "/proj",
    );
    expect(result).toBeNull();
  });

  it("allows a drop landing on rootPath itself", () => {
    const result = resolveMoveTarget(
      "/proj/src/note.txt",
      { kind: "directory", path: "/proj" },
      "/proj",
    );
    expect(result).toEqual({ destinationDir: "/proj", destination: "/proj/note.txt" });
  });
});
