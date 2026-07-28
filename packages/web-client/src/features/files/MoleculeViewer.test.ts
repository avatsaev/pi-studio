import { describe, expect, it } from "vitest";
import { moleculeSource } from "./molecule-source.js";
import { shouldApplyRefresh } from "./molecule-reload.js";

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

describe("shouldApplyRefresh", () => {
  it("no change pushed yet -> false", () => {
    expect(shouldApplyRefresh({ changedAt: null, lastAppliedAt: null, modified: false })).toBe(
      false,
    );
    expect(shouldApplyRefresh({ changedAt: null, lastAppliedAt: null, modified: true })).toBe(
      false,
    );
  });

  it("changed & clean -> true", () => {
    expect(shouldApplyRefresh({ changedAt: 100, lastAppliedAt: null, modified: false })).toBe(
      true,
    );
    expect(shouldApplyRefresh({ changedAt: 200, lastAppliedAt: 100, modified: false })).toBe(true);
  });

  it("changed & modified -> false (unsaved edits are never clobbered)", () => {
    expect(shouldApplyRefresh({ changedAt: 100, lastAppliedAt: null, modified: true })).toBe(
      false,
    );
  });

  it("already-applied changedAt -> false (no reload loop)", () => {
    expect(shouldApplyRefresh({ changedAt: 100, lastAppliedAt: 100, modified: false })).toBe(
      false,
    );
  });
});
