# Task 002 — Molecule format detection (`isMoleculeFile`) in the viewer registry

- **Sprint:** sprint-044-molecule-viewer-live-files
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** none

## Goal
Add a pure, synchronous `isMoleculeFile(path)` predicate (plus the extension/filename sets it reads)
to `viewer-registry.ts`, so the file explorer can route molecular files to a molecule tab.

## Background / why
`viewer-registry.ts` is already the single module that owns "what kind of file is this" knowledge
(`EXT_TO_VIEWER` at lines 37-70, `MIME_PREFIX_TO_VIEWER` at 72-75, `detectViewerKind` at 89-103), so
the molecule format list belongs here rather than in a second map next to it.

It does **not** become a new `ViewerKind`: per `docs/molviewer-integration-scope.md` § 4.3, molecule
files get their own `TabKind` and a dedicated panel, so `FilePanel` never renders a molecule viewer
and a `VIEWER_BY_KIND["molecule"]` slot would be dead code.

The format list is derived from molviewer's actual reader registrations (verified in its
`src/core/parse/readers/index.ts`: xyz, mol, pdb, gro, lammpstrj, mol2, lammps-data, cif, poscar,
xsf).

## Scope references
- `docs/molviewer-integration-scope.md` § 2.1, § 2.2, § 4.1 (no LAMMPS `data`), § 4.3
- `clean-room-scope/features/file-explorer-transfer.md` § file preview / viewer dispatch
- `packages/web-client/AGENTS.md` § features/files

## What to build
- **`packages/web-client/src/features/files/viewer-registry.ts`** — add, next to the existing maps:
  ```ts
  /** Extensions molviewer's built-in readers handle (its readers/index.ts registration list). */
  export const MOLECULE_EXTENSIONS: ReadonlySet<string> = new Set([
    "pdb", "cif", "mmcif", "mol", "mol2", "xyz", "extxyz", "gro", "lammpstrj", "xsf",
  ]);
  /** Extension-less VASP structure files, matched by exact (case-insensitive) basename. */
  export const MOLECULE_FILENAMES: ReadonlySet<string> = new Set(["poscar", "contcar"]);
  export function isMoleculeFile(path: string): boolean;
  ```
  `isMoleculeFile` reuses the existing `extOf(path)` helper (lines 77-81) for the extension case and
  compares the lowercased basename against `MOLECULE_FILENAMES` for the VASP case. Pure and
  synchronous — **no** file reads, no async.
- Update the module's header comment (lines 1-7) to state the second dispatch path: `FilePanel` uses
  `detectViewerKind` for in-panel viewers, while the explorer uses `isMoleculeFile` to choose the
  *tab kind* before any panel mounts.

## Out of scope
- LAMMPS `data` files (§ 4.1: no fixed extension; content-sniffing would make this function async).
  They keep opening as text.
- A manual "open as molecule" context-menu action (§ 4.2 — deliberately deferred with § 4.1).
- Any change to `ViewerKind`, `VIEWER_BY_KIND`, `EXT_TO_VIEWER`, or `detectViewerKind` behavior. A
  `.pdb` opened as a `kind: "file"` tab by some other path must still fall through to `TextViewer`
  exactly as today.

## Acceptance criteria
- [ ] `isMoleculeFile` returns `true` for all ten extensions (any case: `.PDB`, `.Cif`) and for
      `POSCAR`/`CONTCAR`/`poscar` basenames, including when nested (`/a/b/POSCAR`).
- [ ] Returns `false` for `data.lammps`, `in.data`, `readme.md`, `main.ts`, extension-less
      `Makefile`, and a path whose *directory* is named e.g. `pdb/` but whose file isn't
      (`/x/pdb/notes.txt`).
- [ ] `detectViewerKind`'s existing behavior is unchanged (no new `ViewerKind` member).
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- New `packages/web-client/src/features/files/viewer-registry.test.ts` (pure, no DOM) covering every
  acceptance bullet above — the true/false tables and the directory-name false positive.
- Run: `npx vitest run packages/web-client/src/features/files/viewer-registry.test.ts`.

## Notes
- `mmcif` is listed because molviewer's `cifReader` covers CIF/mmCIF; `extxyz` because its
  `xyzReader` covers extended XYZ. Both are documented in that reader index's comments.
- Keep the sets `ReadonlySet` so no caller can mutate the format list at runtime.
