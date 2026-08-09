import { describe, expect, it } from "vitest";
import { moleculeSource } from "./molecule-source.js";
import { shouldApplyRefresh } from "./molecule-reload.js";
import { MOLVIEWER_THEME } from "./molecule-theme.js";
import { polymerFileName } from "./polymer-file.js";

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
    expect(shouldApplyRefresh({ changedAt: 100, lastAppliedAt: null, modified: false })).toBe(true);
    expect(shouldApplyRefresh({ changedAt: 200, lastAppliedAt: 100, modified: false })).toBe(true);
  });

  it("changed & modified -> false (unsaved edits are never clobbered)", () => {
    expect(shouldApplyRefresh({ changedAt: 100, lastAppliedAt: null, modified: true })).toBe(false);
  });

  it("already-applied changedAt -> false (no reload loop)", () => {
    expect(shouldApplyRefresh({ changedAt: 100, lastAppliedAt: 100, modified: false })).toBe(false);
  });
});

describe("MOLVIEWER_THEME", () => {
  it("only overrides background/foreground and control/popover surfaces that pi-studio has an equivalent for", () => {
    expect(Object.keys(MOLVIEWER_THEME).toSorted()).toEqual(
      [
        "--border-control",
        "--border-input",
        "--border-popover",
        "--canvas",
        "--chrome",
        "--control",
        "--control-hover",
        "--control-strong-hover",
        "--popover",
        "--popover-item-hover",
        "--recess",
        "--row-hover",
        "--text-on-control",
        "--text-primary",
        "--well",
      ].toSorted(),
    );
  });

  it("every value chains through a --pi-color-* custom property, never a literal color", () => {
    for (const value of Object.values(MOLVIEWER_THEME)) {
      expect(value).toMatch(/^var\(--pi-color-[a-zA-Z0-9]+\)$/);
    }
  });
});

describe("polymerFileName", () => {
  it("names the first build off the monomer's stem and the chain length", () => {
    expect(polymerFileName({ sourcePath: "/a/b/styrene.pdb", monomers: 10, attempt: 0 })).toBe(
      "styrene_polymer_10.mol2",
    );
  });

  it("suffixes later attempts with their own ordinal, so the first needs none", () => {
    const names = [1, 2, 3].map((attempt) =>
      polymerFileName({ sourcePath: "/a/b/styrene.pdb", monomers: 10, attempt }),
    );
    expect(names).toEqual([
      "styrene_polymer_10_2.mol2",
      "styrene_polymer_10_3.mol2",
      "styrene_polymer_10_4.mol2",
    ]);
  });

  it("always emits mol2, whatever the monomer was loaded from", () => {
    for (const name of ["m.pdb", "m.xyz", "m.cif", "m.gro"]) {
      expect(polymerFileName({ sourcePath: `/a/${name}`, monomers: 4, attempt: 0 })).toBe(
        "m_polymer_4.mol2",
      );
    }
  });

  it("strips only the last extension, so a dotted stem survives", () => {
    expect(polymerFileName({ sourcePath: "/a/4hhb.final.pdb", monomers: 3, attempt: 0 })).toBe(
      "4hhb.final_polymer_3.mol2",
    );
  });

  it("keeps an extensionless monomer's whole name as the stem", () => {
    expect(polymerFileName({ sourcePath: "/a/POSCAR", monomers: 7, attempt: 0 })).toBe(
      "POSCAR_polymer_7.mol2",
    );
  });

  it("falls back to `polymer` for a name that is entirely extension", () => {
    expect(polymerFileName({ sourcePath: "/a/.pdb", monomers: 5, attempt: 0 })).toBe(
      "polymer_polymer_5.mol2",
    );
  });

  it("uses the basename, never the directory", () => {
    expect(
      polymerFileName({ sourcePath: "/deep/nested.dir/styrene.pdb", monomers: 2, attempt: 0 }),
    ).toBe("styrene_polymer_2.mol2");
  });
});
