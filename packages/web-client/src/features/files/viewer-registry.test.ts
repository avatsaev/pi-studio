import { describe, expect, it } from "vitest";
import {
  detectViewerKind,
  isMoleculeFile,
  VIEWER_REGISTRY,
  LIVE_REFRESH_KINDS,
} from "./viewer-registry.js";

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

describe("VIEWER_REGISTRY", () => {
  it("no extension is claimed by two descriptors", () => {
    const allExtensions = new Set<string>();
    for (const descriptor of VIEWER_REGISTRY) {
      for (const ext of descriptor.extensions) {
        expect(allExtensions.has(ext)).toBe(false);
        allExtensions.add(ext);
      }
    }
  });

  it("includes text, markdown, image, and html in the live-refresh set", () => {
    expect(LIVE_REFRESH_KINDS.has("text")).toBe(true);
    expect(LIVE_REFRESH_KINDS.has("markdown")).toBe(true);
    expect(LIVE_REFRESH_KINDS.has("image")).toBe(true);
    expect(LIVE_REFRESH_KINDS.has("html")).toBe(true);
  });

  it("excludes video and binary from the live-refresh set", () => {
    expect(LIVE_REFRESH_KINDS.has("video")).toBe(false);
    expect(LIVE_REFRESH_KINDS.has("binary")).toBe(false);
  });

  it("detects html/htm/xhtml as the html kind; svg stays image, not html", () => {
    expect(detectViewerKind("report.html")).toBe("html");
    expect(detectViewerKind("report.HTML")).toBe("html");
    expect(detectViewerKind("legacy.htm")).toBe("html");
    expect(detectViewerKind("doc.xhtml")).toBe("html");
    expect(detectViewerKind("diagram.svg")).toBe("image");
  });
});
