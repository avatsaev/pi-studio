# Task 002 — Summary

## What was built
- `packages/web-client/src/features/files/viewer-registry.ts`:
  - `MOLECULE_EXTENSIONS` and `MOLECULE_FILENAMES` — implemented as `Readonly<Record<string, true>>`
    membership tables, **not** `ReadonlySet<string>` as the task's own draft snippet suggested. The
    project's `ts-set-map` convention (fired as a rule during implementation) prefers `Record` for
    small, static, string-keyed lookup/membership tables — exactly this case, and consistent with the
    file's pre-existing `EXT_TO_VIEWER: Record<string, ViewerKind>`. `isMoleculeFile` looks up via
    `table[key]` truthiness instead of `.has()`; behavior is identical.
  - `isMoleculeFile(path)` — checks the extension table via the existing `extOf()` helper, then the
    basename table (lowercased) for `POSCAR`/`CONTCAR`. Pure, synchronous, no file reads.
  - Updated the module header comment to document the second dispatch path (explorer picks tab
    *kind* via `isMoleculeFile` before any panel mounts; `FilePanel`/`detectViewerKind` untouched).
- `packages/web-client/src/features/files/viewer-registry.test.ts` (new) — 4 tests covering every
  acceptance bullet: all 10 extensions case-insensitively, VASP basenames (including nested paths),
  the false-cases table (LAMMPS `data`, near-miss `/x/pdb/notes.txt`, etc.), and confirmation that
  `detectViewerKind`'s existing behavior — including a `.pdb` still falling through to `"text"` — is
  unchanged.

## Verification
- `npx vitest run packages/web-client/src/features/files/viewer-registry.test.ts` — 4/4 pass.
- `npm run build:web-client` — succeeds, no new warnings.
- `npm run typecheck` — passes (`tsc -b`, no errors).
- `npx oxlint` on both changed files — zero issues.

## Acceptance criteria
- [x] `isMoleculeFile` returns `true` for all ten extensions (any case) and POSCAR/CONTCAR basenames,
      including nested paths.
- [x] Returns `false` for `data.lammps`, `in.data`, `readme.md`, `main.ts`, extension-less
      `Makefile`, and `/x/pdb/notes.txt`.
- [x] `detectViewerKind`'s existing behavior is unchanged (no new `ViewerKind` member — confirmed
      `ViewerKind` union and `VIEWER_BY_KIND` are untouched).
- [x] `npm run build:web-client` and `npm run typecheck` pass.

## Deviations from the task draft
- `Set` → `Record<string, true>` (see above) — a mechanical convention swap, no behavioral change.

## Follow-up for task-004
`isMoleculeFile` is ready to import into `FileExplorer.tsx`'s `handleOpenFile`.
