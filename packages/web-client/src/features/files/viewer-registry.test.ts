import { describe, expect, it } from "vitest";
import { detectViewerKind, isMoleculeFile } from "./viewer-registry.js";

describe("isMoleculeFile", () => {
  it("recognizes every supported molecule extension, case-insensitively", () => {
    const extensions = [
      "pdb",
      "cif",
      "mmcif",
      "mol",
      "mol2",
      "xyz",
      "extxyz",
      "gro",
      "lammpstrj",
      "xsf",
    ];
    for (const ext of extensions) {
      expect(isMoleculeFile(`/a/b/structure.${ext}`)).toBe(true);
      expect(isMoleculeFile(`/a/b/structure.${ext.toUpperCase()}`)).toBe(true);
    }
  });

  it("recognizes extension-less VASP filenames by exact basename, case-insensitively", () => {
    expect(isMoleculeFile("POSCAR")).toBe(true);
    expect(isMoleculeFile("CONTCAR")).toBe(true);
    expect(isMoleculeFile("poscar")).toBe(true);
    expect(isMoleculeFile("/a/b/POSCAR")).toBe(true);
    expect(isMoleculeFile("/a/b/contcar")).toBe(true);
  });

  it("returns false for non-molecule files, including LAMMPS data and near-miss paths", () => {
    expect(isMoleculeFile("data.lammps")).toBe(false);
    expect(isMoleculeFile("in.data")).toBe(false);
    expect(isMoleculeFile("readme.md")).toBe(false);
    expect(isMoleculeFile("main.ts")).toBe(false);
    expect(isMoleculeFile("Makefile")).toBe(false);
    // Directory named like a molecule format, but the file itself isn't one.
    expect(isMoleculeFile("/x/pdb/notes.txt")).toBe(false);
  });

  it("leaves detectViewerKind's existing behavior unchanged", () => {
    expect(detectViewerKind("readme.md")).toBe("markdown");
    expect(detectViewerKind("photo.png")).toBe("image");
    expect(detectViewerKind("clip.mp4")).toBe("video");
    expect(detectViewerKind("archive.zip")).toBe("binary");
    expect(detectViewerKind("main.ts")).toBe("text");
    // A molecule file with no dedicated ViewerKind still falls through to text, exactly as today.
    expect(detectViewerKind("structure.pdb")).toBe("text");
  });
});
