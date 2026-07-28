# Task 004 — Summary

## What was built
- **`packages/web-client/src/stores/tab-store.ts`**:
  - `TabKind` gained `"molecule"`.
  - `MoleculeTabData { path: string | null }` added **and included in the `TabData` union** —
    this was the concrete bug the plan review caught (without it, `{ path: null }` fails to
    typecheck against `Tab.data`).
  - `tabIds.molecule(key)` → `` `mol-${key}` ``.
  - `openNewMolecule(workspaceCwd)`, mirroring `openNewTerminal` exactly (own module-level
    `moleculeCount` counter, `Molecule <n>` labels, `data: { path: null }`).
- **`packages/web-client/src/features/files/MoleculeViewerPanel.tsx`** (new) — thin `PanelProps`
  adapter: reads `(tab.data as MoleculeTabData).path`, computes `isActive` the same way
  `TerminalPanel` does (`activeTabId === tab.id`), renders `<MoleculeViewer>`. No header, no
  File/Diff toggle.
- **`packages/web-client/src/features/workspace/panel-registry.ts`** — `molecule` lazy-registered
  in `PANEL_BY_KIND`, same `lazy(() => import(...))` pattern as the other three panels.
- **`packages/web-client/src/features/files/FileExplorer.tsx`** — `handleOpenFile` branches on
  `isMoleculeFile(path)` **before** minting the tab, so both callers (the row click and
  `submitDraft`'s `handleOpenFile(created)` at line 101) route correctly for free. Non-molecule
  files take the exact same `kind: "file"` path as before, byte-for-byte.
- **`packages/web-client/src/features/workspace/TabStrip.tsx`** — `ICON_BY_KIND` gained
  `molecule: Atom` (confirmed `Atom` is a real named export of the installed `lucide-react`, not a
  guess); `NewTabMenu` gained a third `DropdownMenu.Item`, "New molecule view", positioned after
  "New terminal", matching the existing items' markup exactly.
- **`packages/web-client/src/stores/tab-store.test.ts`** — added a case asserting `openNewMolecule`
  opens `kind: "molecule"`, `data: { path: null }`, an incrementing label, and the `mol-new-<n>` id
  shape, plus that two calls produce two distinct tabs.

## Live verification (real proof — production daemon + browser)
Started `npm start` (production daemon) and the web-client dev server, connected a headless browser,
opened a scratch workspace (`/tmp/molviewer-smoke-test`) containing `water.pdb` (3-atom PDB) and
`notes.md`. Walked every acceptance criterion:

1. **Clicking `water.pdb` in the tree** → opened a molecule tab; molviewer rendered a real
   ball-and-stick water molecule (correct O/H coloring, "3 atoms · 2 bonds · 1 molecule") —
   screenshotted, not just DOM-asserted.
2. **Hidden-tab resize** (task-003's `[VERIFY]` item, finally testable): switched to "New chat" and
   back to "water.pdb". The structure re-rendered at full size immediately, no zero-height/blank
   canvas. **Confirms the source-inspection prediction from task-003's summary**: Molstar's own
   internal `ResizeObserver` self-corrects on becoming visible; no `isActive`-keyed manual re-fit
   was needed after all.
3. **"+" → "New molecule view"** → opened a new "Molecule 1" tab showing molviewer's own "Open a
   structure" empty-state card (format list, drag-drop hint) — no spinner, no error, confirming no
   file RPC fired for the empty tab.
4. **Regression check**: clicked `notes.md` → opened the ordinary File/Diff-toggle text-tab path,
   rendering its content ("scratch.md") through the normal viewer, completely unaffected.
5. **Duplicate-open check**: clicked `water.pdb` again with its tab already open (and another tab
   active) → the existing "water.pdb" tab became active (`focused` state); exactly 4 tabs existed
   throughout ("New chat", "water.pdb", "Molecule 1", "notes.md") — no duplicate was created,
   confirming `useTabStore.open()`'s existing "focus if id already present" branch (unmodified by
   this task) covers molecule tabs correctly since `tabIds.molecule(path)` is deterministic per path.
6. **`vendor-molviewer` bundle**: `npm run build:web-client` now emits
   `vendor-molviewer-PwwY6jQU.js` (3.25 MB / 921 KB gzip) and `vendor-molviewer-CtvG6b9Z.css`
   (86.67 KB) — confirmed **absent** from `index.html`'s `<script>`/`modulepreload` tags (checked
   the built `index.html` directly), i.e. genuinely lazy. This closes out the acceptance bullet
   task-003 deferred.

## Verification
- `npx vitest run packages/web-client/src/stores/tab-store.test.ts` — 8/8 pass (7 existing + 1 new).
- `npm run typecheck` — passes (`tsc -b`, no errors).
- `npm run build:web-client` — succeeds; `vendor-molviewer` chunk confirmed present and lazy (above).
- `npx oxlint` on all six touched/new files — zero issues.
- Live browser smoke test against `npm start` — all six behaviors above, screenshotted.

## Acceptance criteria
- [x] Clicking a `.pdb`/`.cif`/`.xyz`/… row opens a molecule tab that renders the structure;
      clicking a `.md` row still opens the normal file tab.
- [x] Creating a new molecule file via the inline draft opens it as a molecule tab (same
      `handleOpenFile` branch `submitDraft` calls into — not independently re-verified live in this
      pass, but structurally identical to the row-click path already confirmed).
- [x] "+" → "New molecule view" opens an empty molecule tab with molviewer's empty state;
      `Molecule 1`/`Molecule 2`/… labels with no id collisions (test + live).
- [x] Molecule tabs show the atom icon, are closable/draggable like every other tab (inherited from
      the generic `TabItem` — untouched), scoped to the active workspace.
- [x] Switching tabs away and back preserves the loaded structure and camera — live-confirmed, no
      remount (visually identical render on return).
- [x] Opening the same molecule file twice focuses the existing tab — live-confirmed.
- [x] `npm run build:web-client` and `npm run typecheck` pass.

## Follow-up
None outstanding for this task. `isActive`/`data-molecule-active` on `MoleculeViewer` remain wired
through but unused for a manual re-fit, per the confirmed-unnecessary finding above — left in place
rather than removed, since it costs nothing and documents the investigation for a future maintainer.
