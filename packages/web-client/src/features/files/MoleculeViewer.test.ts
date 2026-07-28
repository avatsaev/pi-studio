import { describe, expect, it } from "vitest";
import { moleculeSource } from "./molecule-source.js";

describe("moleculeSource", () => {
  it("returns null for a null path (empty molecule tab)", () => {
    expect(moleculeSource(null, "blob:abc")).toBeNull();
  });

  it("returns null while no object URL is available yet", () => {
    expect(moleculeSource("/a/b/structure.pdb", undefined)).toBeNull();
    expect(moleculeSource("/a/b/structure.pdb", null)).toBeNull();
  });

  it("derives { url, name } from the basename of the path", () => {
    expect(moleculeSource("/a/b/structure.pdb", "blob:abc")).toEqual({
      url: "blob:abc",
      name: "structure.pdb",
    });
  });

  it("falls back to the full path as name when there is no separator", () => {
    expect(moleculeSource("structure.pdb", "blob:abc")).toEqual({
      url: "blob:abc",
      name: "structure.pdb",
    });
  });
});
