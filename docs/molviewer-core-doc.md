# `@molviewer/core` — usage reference

> Internal reference for using the `@molviewer/core` npm package inside pi-studio (e.g. in
> `web-client` to render molecular structures / MD trajectories produced or inspected by an
> agent). Written by reading the package's **actual installed source** at
> `node_modules/@molviewer/core` (v0.3.0) and cross-checked against the upstream repo's source
> tree (`../molviewer/src`), not just its prose docs — the upstream `README.md`/`AGENTS.md`
> described an older API shape in several places at the time this was written (now fixed
> upstream too — see [Discrepancies found & fixed upstream](#discrepancies-found--fixed-upstream)
> at the bottom).

---

## What it is

An offline, browser-native 3D molecular viewer and light structure editor for small molecules and
MD trajectories, built on the [Mol\*](https://molstar.org) WebGL engine. Nothing is uploaded —
parsing happens entirely client-side. Ships as:

- a single React component, `MolViewer`, with a full imperative handle, plus
- a framework-free **core** (parsing, data model, geometry, export) usable with no React and no
  Mol\* — in Node, a worker, or a CLI.

Stack requirements: React 18.3 or 19 (peer dependency, **not bundled** — see
[Packaging notes](#packaging-notes)), Mol\* 4.9+ (bundled into `dist`, ~3.4 MB).

## Install

```bash
npm install @molviewer/core react react-dom
```

`react` / `react-dom` are `peerDependencies` (`^18.3.0 || ^19.0.0`) — the host's copy is used;
never end up with two React instances on the page (breaks hooks).

## Basic usage

```tsx
import { MolViewer } from '@molviewer/core';
import '@molviewer/core/style.css';

export function App() {
  return (
    <div style={{ height: '100vh' }}>
      <MolViewer />
    </div>
  );
}
```

The component fills whatever box it's given — **give it an explicit height**, or it collapses to
`height: 100%` with a `minHeight: 480` fallback (`MolViewer.tsx`'s root style).

Fonts (IBM Plex) are **not bundled**; without them the theme falls back to `system-ui`. See
[Packaging notes](#packaging-notes).

---

## Loading structures — the `source` / `sourceMode` props

```ts
type MolViewerSource =
  | File
  | { name: string; text: string }
  | { name: string; bytes: ArrayBuffer }
  | { url: string; name?: string }
  | { system: System; name?: string };
```

- Pass a `File` directly (e.g. from a drop handler or `<input type="file">`'s `.files[0]`) — there
  is **no** `{ file: ... }` wrapper and no `HTMLInputElement` acceptance; unwrap the input
  yourself.
- `{ name, text }` — load from an in-memory string; `name` supplies the extension used for format
  resolution (required, since it can't be derived otherwise).
- `{ name, bytes }` — load from an `ArrayBuffer` (not `Uint8Array`).
- `{ url, name? }` — fetch and load; `onLoadProgress` reports progress during the fetch.
- `{ system, name? }` — hand it an already-parsed `System` (e.g. built via the core API below,
  or via `buildSupercell`).

```tsx
<MolViewer
  source={{ name: 'water.mol', text: waterMolText }}
  sourceMode="replace"
/>
```

`sourceMode?: 'replace' | 'update'` (prop on `MolViewer`, **not** part of `source`):
- `'replace'` (default) — new structure: resets settings to `initialView`, refits the camera,
  clears undo history, resets the dirty flag.
- `'update'` — a new *version* of what's on screen: swaps geometry only. Camera, settings,
  selection (if atom count is stable), the user's periodic box and active tool are all preserved;
  undo history is cleared and the viewer becomes unmodified again.

There is a third mode, `'add'` (append atoms to the current structure), but it is **only**
reachable through the imperative handle — `ref.current.load(source, { mode: 'add' })` — not
through the `source`/`sourceMode` props. `LoadEvent.mode` can report `'add'` when it happens (e.g.
via the built-in drag-and-drop "combine" dialog).

Changing `source` (by reference — the effect does `Object.is` comparison, so a fresh inline
literal on every render re-triggers the load) triggers a new load; swapping it again before the
previous load finishes cancels the stale one.

---

## The imperative handle

```tsx
import { MolViewer, type MolViewerHandle } from '@molviewer/core';
import { useRef } from 'react';

const ref = useRef<MolViewerHandle>(null);

<MolViewer ref={ref} />;
```

```ts
interface MolViewerHandle {
  load(source: MolViewerSource, opts?: { mode?: 'replace' | 'add' | 'update' }): Promise<void>;
  update(source: MolViewerSource): Promise<void>;   // sugar for load(source, { mode: 'update' })
  getState(): ViewerState;                           // full live state (read-only; system aliases mutable typed arrays)
  getSystem(): System | null;
  getSettings(): ViewerSettings;
  setSettings(patch: Partial<ViewerSettings>): void; // non-undoable; fires onViewChange
  setTool(tool: Tool): void;
  select(atomIndices: number[], opts?: { additive?: boolean }): void;
  selectAll(): void;
  clearSelection(): void;
  setFrame(index: number): void;
  play(): void;   // needs the Trajectory panel mounted (ui.panels.trajectory) to actually advance
  pause(): void;
  undo(): void;
  redo(): void;
  isModified(): boolean;
  exportText(formatId?: string): string;   // defaults to defaultExportId(sourceFormat)
  exportFile(formatId?: string): File;     // returns a File — does NOT trigger a download itself
  resetView(): void;
  recenter(): void;
  screenshot(): Promise<Blob>;
  engine(): RenderEngine | null;
  dispatch(action: Action): void;          // escape hatch; routes through interceptAction too
}
```

Important: `exportFile()` **returns** a `File`; the host must trigger the download itself (there
is no built-in "save as" side effect on this call):

```ts
const file = ref.current!.exportFile('mol2'); // or exportFile() for the format's own default
const url = URL.createObjectURL(file);
const a = document.createElement('a');
a.href = url;
a.download = file.name;
a.click();
URL.revokeObjectURL(url);
```

`play()` flips `state.playing`, but the actual frame-advance loop lives inside the built-in
Trajectory panel — if you hide it (`ui.panels.trajectory: false`), `play()` alone won't animate
anything.

---

## Events (`MolViewerProps`)

All optional, independent, can fire together in a single dispatch:

```ts
onReady?: (handle: MolViewerHandle) => void;              // engine + UI mounted; handle passed directly
onLoad?: (e: LoadEvent) => void;
onLoadError?: (e: { error: Error; fileName: string | null }) => void;
onLoadProgress?: (progress: number | null) => void;       // a single number, NOT {loaded,total}
onSelectionChange?: (e: SelectionEvent) => void;
onFrameChange?: (e: { frame: number; frameCount: number }) => void;
onToolChange?: (tool: Tool) => void;
onEdit?: (e: EditEvent) => void;            // molecule modifications ONLY (never fires for appearance)
onModifiedChange?: (modified: boolean) => void;  // fires only on the clean<->dirty transition
onViewChange?: (view: ViewerViewState) => void;  // any non-molecular view change
```

```ts
interface LoadEvent {
  system: System; fileName: string | null;
  atomCount: number; frameCount: number; mode: 'replace' | 'add' | 'update';
}
interface SelectionEvent {
  atoms: number[]; bond: [number, number] | null; boxSelected: boolean;
}
interface EditEvent {
  label: string;          // e.g. 'Moved', 'Atoms deleted', 'Bond order changed'
  seq: number;
  system: System | null;
  modified: boolean;      // whether the viewer now differs from the loaded file (== isModified())
}
```

`onEdit` fires for molecule modifications only (geometry, elements, atom names, bonds, atom count,
or the cell) — appearance/view changes fire `onViewChange` instead, never `onEdit`. The two are
**not** mutually exclusive within one user gesture: e.g. deleting a selection fires both `onEdit`
*and* `onSelectionChange` (selection clears) in the same dispatch.

`onModifiedChange` fires only on the clean↔dirty transition — `true` after the first molecule
edit, `false` again on undo back to the loaded structure, and `false` on every fresh
load/update.

### Fine-grained interaction hooks (`interactions` prop)

Separate from the events above — cancelable, low-level pointer/keyboard interception:

```ts
interface MolViewerInteractions {
  onAtomClick?(e: AtomClickEvent): void;   // { atomIndex, button, ctrl, x, y, tool, system }
  onBondClick?(e: BondClickEvent): void;   // { atoms: [number, number], button, ctrl, x, y, tool, system }
  onBoxClick?(e: BoxClickEvent): void;     // { button, ctrl, x, y, tool }
  onEmptyClick?(e: EmptyClickEvent): void; // { button, x, y, tool }
  onKeyDown?(e: ViewerKeyEvent): void;     // { native: KeyboardEvent, key, ctrl, shift, alt }
  onFileOpen?(e: FileOpenEvent): void;     // { files: File[], mode: 'replace' | 'add' }
  onContextMenuOpen?(e: ContextMenuOpenEvent): void;
}
```

Every event here extends `CancelableEvent` (`{ readonly defaultPrevented; preventDefault(): void }`)
— call `e.preventDefault()` inside the handler to block the viewer's default behavior for that
interaction (e.g. block atom picking, block dropped files from opening):

```tsx
<MolViewer
  interactions={{
    onAtomClick: (e) => { if (blockPicks) e.preventDefault(); },
    onFileOpen: (e) => console.log(`drop: ${e.mode}`, e.files.map((f) => f.name)),
  }}
/>
```

`contextMenuItems?: (ctx: ContextMenuContext) => ContextMenuItem[]` appends extra rows to the
bottom of the built-in right-click menu:

```tsx
<MolViewer
  contextMenuItems={(ctx) => [
    { id: 'host', label: 'Log selection', onSelect: () => console.log(ctx.selectedAtoms) },
  ]}
/>
```

---

## UI composition (`ui` prop)

```ts
interface MolViewerUiConfig {
  sidebar?: boolean;            // default true — the whole <aside> + resizer
  sidebarWidth?: number;        // default 360, clamped 320..460
  sidebarResizable?: boolean;   // default true
  footer?: boolean;             // default true
  fileCard?: boolean;           // default true
  scopeBar?: boolean;           // default true
  toolRail?: boolean;           // default true
  viewRail?: boolean;           // default true
  measurePanel?: boolean;       // default true
  axesWidget?: boolean;         // default true
  drawHint?: boolean;           // default true
  editToast?: boolean;          // default true
  emptyState?: boolean;         // default true — the first-run placeholder card
  loadingOverlay?: boolean;     // default true
  contextMenu?: boolean;        // default true
  dropToOpen?: boolean;         // default true — drag/drop onto the root element
  panels?: {
    appearance?: boolean; trajectory?: boolean; placement?: boolean;
    structure?: boolean; box?: boolean; diagnostics?: boolean;  // all default true
  };
}
```

Everything under `ui` toggles a **panel/chrome element**, nothing else. Keyboard shortcuts,
theming and action interception are **separate, top-level props** — not nested inside `ui`:

```tsx
<MolViewer
  ui={{ sidebar: false, toolRail: false, viewRail: false, emptyState: false }}
  keyboardShortcuts="global"                 // boolean | 'global'; default true (root-scoped)
  theme={{ '--accent': '#ff8a00' }}           // raw CSS custom properties, not { accentColor }
  interceptAction={(action, state) => {
    if (action.type === 'DELETE_SELECTED') return null;  // drop it
    return undefined;                                     // apply unchanged (or return a rewritten action)
  }}
/>
```

A minimal "headless, embedded" viewer (as used for a secondary/preview instance):

```tsx
<MolViewer
  ui={{ sidebar: false, toolRail: false, viewRail: false, emptyState: false }}
  theme={{ '--accent': '#ff8a00' }}
  source={{ url: '/examples/water.gro' }}
  style={{ height: 400 }}
/>
```

`interceptAction: (action: Action, state: ViewerState) => Action | null | void` is the single
chokepoint every dispatch — including the imperative handle's `dispatch()` — routes through.
Return the action (possibly rewritten) to apply it, `null` to drop it, or `undefined`/nothing to
apply it unchanged.

---

## `ViewerSettings` — the seedable/non-undoable view state

```ts
interface ViewerSettings {
  representation: RepresentationSpec;
  colorScheme: ColorScheme;
  labelMode: LabelMode;
  cellVisible: boolean;
  axesVisible: boolean;
  boxColor: string;
  backgroundColor: string;
  pbcMode: PbcMode;             // 'none' | 'wrap' | 'unwrap'
  playbackFps: number;
  bondTolerance: number;
  drawElement: number;          // atomic number the draw tool places
  moveMode: MoveMode;           // 'last' | 'first' | 'both'
}
```

```ts
type RepresentationKind = 'line' | 'stick' | 'ball-and-stick' | 'cpk';
interface RepresentationSpec {
  kind: RepresentationKind;
  selection?: string;            // atom-selection expression; whole system if omitted
  lineWidth?: number;            // 'line' only
  ballRadius?: number;           // 'ball-and-stick' only
  stickRadius?: number;          // 'ball-and-stick' only
  showHydrogens?: boolean;       // default true
  showBonds?: boolean;           // default true; no effect on 'cpk'
}

type ColorScheme = { by: 'element' } | { by: 'uniform'; rgb: [number, number, number] };
type LabelMode = 'none' | 'index' | 'name';   // no 'element' value
```

Set via the handle (non-undoable, fires `onViewChange`, never `onEdit`):

```ts
ref.current?.setSettings({
  representation: { kind: 'cpk' },
  labelMode: 'index',
});
```

Or seed once at mount via `initialView?: Partial<ViewerSettings>` (read once; changing it after
mount is ignored — use `setSettings` instead):

```tsx
<MolViewer initialView={{ representation: { kind: 'cpk' }, backgroundColor: '#101820' }} />
```

`ViewerViewState` (the `onViewChange` payload) is a strict superset — adds `selection: string`,
`atomColors: Record<number, [r,g,b]>`, `atomSizes: Record<number, number>`,
`bondSizes: Record<string, number>`, `bondRules: BondRuleMap`. Those extras are observable but not
seedable via `initialView`/`setSettings` (they're index/pair-keyed, not portable).

---

## The framework-free core — no React, no Mol\*, no DOM

Everything above is layered on a pure-TypeScript core that runs in Node, a worker, or a CLI:

```ts
import {
  parseSystem, createDefaultRegistry, sourceFromText, sourceFromBytes,
  buildSupercell, EXPORT_FORMATS, exportFormatById, defaultExportId,
  systemToMmcif, perceiveBonds, reperceiveBonds,
} from '@molviewer/core';

const registry = createDefaultRegistry();               // registers all 10 built-in readers
const source = sourceFromText('water.mol2', mol2Text);
const system = await parseSystem(source, registry);      // resolve -> read -> infer elements -> perceive bonds

const big = buildSupercell(system, 2, 2, 2);              // analytic replication, seam bonds re-derived correctly
const mol2 = EXPORT_FORMATS.find((f) => f.id === 'mol2')!.serialize(big, /* frameIndex */ 0);
```

### Supported formats (readers)

| id | extensions | elements | bonds | cell |
|---|---|---|---|---|
| `xyz` | `.xyz` `.extxyz` | from symbols | perceived | extended-XYZ `Lattice="..."` |
| `mol` | `.mol` `.sdf` | from symbols (authoritative) | from file, with orders | none |
| `pdb` | `.pdb` `.ent` | element column (authoritative) | `CONECT` | `CRYST1` |
| `gro` | `.gro` | inferred from force-field names | perceived | box line (nm → Å) |
| `lammpstrj` | `.lammpstrj` `.dump` `.trj` | numeric types → UI mapping | perceived | `BOX BOUNDS`, incl. triclinic |
| `mol2` | `.mol2` | from `@<TRIPOS>ATOM` | from file, with orders | `@<TRIPOS>CRYSIN` |
| `lammps-data` | `.data` `.lmp` `.lammps` | via `Masses` section | from file | `xlo xhi` + `xy xz yz` |
| `cif` | `.cif` `.mmcif` | `type_symbol` | perceived | `_cell.*` |
| `poscar` | `.poscar` `.contcar` `.vasp` | species line | perceived | 3×3 lattice block |
| `xsf` | `.xsf` `.axsf` | atomic numbers | perceived | `PRIMVEC` |

Only `xyzReader`, `molReader`, `pdbReader`, `groReader` are exported individually by name from
`@molviewer/core`; the other six (lammpstrj, mol2, lammps-data, cif, poscar, xsf) are only
reachable through `createDefaultRegistry()` / `registerBuiltinReaders()`.

### Export formats

| id | format | bonds | orders | cell |
|---|---|---|---|---|
| `mol2` | Tripos MOL2 | yes | yes | yes (`CRYSIN`) |
| `mol` | MDL MOL V2000 | yes | yes | no |
| `cif` | mmCIF | yes | yes | yes — highest fidelity |
| `pdb` | PDB | yes | single order only | yes (`CRYST1`) |
| `xyz` | extended XYZ | no | no | yes (9-component `Lattice`) |

`defaultExportId(sourceFormat)` picks a sensible default per input format (MD dumps with no
file-provided bonds default to `mol2` so the perceived connectivity and cell both survive).

### The data model (`System`)

```ts
interface System {
  topology: Topology;      // time-independent: atoms, elements, bonds
  cell: Cell | null;       // system-level lattice (constant-cell runs)
  frames: FrameSource;     // the trajectory (EagerFrameSource is the only implementation today)
  isReactive: boolean;     // true => bonds may legitimately change per frame (AIMD/ReaxFF)
  provenance: Provenance;  // sourceFormat, units, inferenceLog
}

interface Topology {
  atomCount: number;
  atomicNumber: Int16Array;         // INFERRED element; 0 = unknown
  rawLabel: string[];               // exactly what the file said; never mutated by inference
  elementSource: ElementSource[];   // FILE | PERCEIVED_FROM_LABEL | USER_SET | UNKNOWN
  elementConfidence: Float32Array;  // 0..1
  bonds: Bond[];                    // { i, j, order } — order 1|2|3, 1.5 = aromatic
  bondSource: BondSource;           // FILE | PERCEIVED | NONE
  hierarchy: Hierarchy | null;
}

interface Frame {
  positions: Float32Array;                // packed [x0,y0,z0, ...], length 3*atomCount
  cell: Cell | null;                      // per-frame cell (NPT); null => System.cell
  perAtom: Record<string, Float32Array>;  // e.g. charge, forceMag
}

interface Cell {
  vectors: Float64Array;   // [ax,ay,az, bx,by,bz, cx,cy,cz] — three ROW vectors, row-major
  pbc: [boolean, boolean, boolean];
  origin: Float64Array;    // [ox,oy,oz]
}
```

Design rule worth internalizing before writing anything that touches a `System`: **what the file
said (`rawLabel`) is never overwritten by inference.** Ambiguous labels get resolved to an element
by `ElementInferencePass` with a confidence and a `provenance.inferenceLog` entry; the raw label
survives untouched. Per-atom numeric data is always flat typed arrays, never arrays of `{x,y,z}`
objects.

---

## Packaging notes (why the bundle looks the way it does)

- **React is external** (peer dependency) — two React copies on one page break hooks.
- **Mol\* is bundled** (~3.4 MB) — it has no bare entry point and imports its own `.scss` skin, so
  leaving it external would force the host to resolve deep `molstar/lib/...` paths and run a Sass
  pipeline. If the host app already depends on Mol\* itself, add it to `external` in the host's own
  bundler config to avoid shipping it twice.
- **Fonts (IBM Plex) are NOT bundled.** Vite's library mode inlined all five faces as ~912 kB of
  base64 (91% binary, ungzippable) inside what would otherwise be an 87 kB stylesheet. Without
  them, the theme falls back to `system-ui`. To get the intended typography:
  ```bash
  npm install @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono
  ```
  ```ts
  import '@fontsource/ibm-plex-sans/400.css';   // + 500, 600 if using those weights
  import '@fontsource/ibm-plex-mono/400.css';   // + 500
  ```
- `sideEffects: ["**/*.css"]` in `package.json` — only stylesheets have side effects, so bundlers
  can tree-shake the rest of the package.

## Known limitations (upstream, as of v0.3.0)

- Trajectory playback is CPU-bound on the mmCIF-string hand-off to Mol\* per frame — roughly
  ≤18 fps at 50k atoms, ≤8 fps at 100k atoms. Not a rendering (GPU) bottleneck.
- Only an eager, array-backed `FrameSource` exists — an entire trajectory is held in memory; no
  disk-backed lazy source yet.
- Whole file is parsed on the main thread — the UI can freeze on very large dumps.
- No binary trajectory formats (XTC/TRR).
- Aromatic bond order (1.5) is read/preserved but not offered as a UI choice.
- `Hierarchy` (chains/residues) is parsed from PDB but not yet surfaced in the UI.

---

## Discrepancies found & fixed upstream

While writing this reference (against `@molviewer/core` v0.3.0), the upstream repo's own
`README.md` and `AGENTS.md` were found to describe an older shape of the public API — same
package, but the prose docs hadn't kept pace with `src/ui/api.ts`. These have since been
corrected upstream (in `../molviewer`), but are recorded here because they're exactly the kind of
mismatch worth re-checking if a future `@molviewer/core` upgrade seems to break something this
document says works:

1. `MolViewerSource` shape — old docs showed `{ file: HTMLInputElement | File; mode? }`, a `text`
   variant with `fileName` instead of `name`, and `bytes: Uint8Array` instead of `ArrayBuffer`;
   real type is `File | { name, text } | { name, bytes: ArrayBuffer } | { url, name? } | { system,
   name? }` with no `mode` field at all.
2. Load mode — old docs put `mode: 'replace'|'add'|'update'` on `source`; it's actually the
   separate `sourceMode` prop, and only `'replace'|'update'` are reachable there (`'add'` only via
   `handle.load(source, {mode:'add'})`).
3. `ui.keyboard`, `ui.theme`, `ui.interceptAction` — these don't exist; `keyboardShortcuts`,
   `theme`, and `interceptAction` are top-level `MolViewerProps`, not nested under `ui`.
4. `ui` itself has 16 boolean toggles + a 6-boolean `panels` sub-object; old docs mentioned only
   `sidebar`.
5. `MolViewerHandle` has 19 methods; old docs listed 8 (missing `load`, `update`, `getState`,
   `setTool`, `selectAll`, `clearSelection`, `setFrame`, `play`, `pause`, `undo`, `redo`,
   `resetView`, `recenter`, `engine`, `dispatch`).
6. `exportFile()` returns a `File`; it does not itself trigger a download.
7. `ViewerSettings` has 12 fields, not 4; `representation` is an object (`{ kind, ... }`) with
   `kind` in `'line'|'stick'|'ball-and-stick'|'cpk'` (not `'spacefill'`/`'licorice'`); `labelMode`
   has no `'element'` value; there is no `boxVisibility` (`cellVisible`) or `accentColor` field.
8. `onToolChange`, the whole `interactions` prop family, `contextMenuItems`, `registry`,
   `engineFactory`, `maxFileBytes`, `initialView`, and `className` were entirely undocumented.
9. `onLoadProgress(progress: number | null)` and `onReady(handle: MolViewerHandle)` — old docs had
   `onLoadProgress(e: {loaded,total})` and a no-arg `onReady()`.
10. `EditEvent` is `{ label, seq, system, modified }`, not `{ label, seq, molecule }`.
11. Stale version numbers in inline `npm pack` examples (`0.1.0`/`0.2.0` vs. the actual `0.3.0`).
12. Dead cross-references to a `DOCUMENTATION.md` and an `ARCHITECTURE.md` that didn't exist in
    the checked-out tree (now removed; `AGENTS.md` is the single complete reference).
