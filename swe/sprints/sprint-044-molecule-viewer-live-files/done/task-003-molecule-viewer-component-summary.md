# Task 003 — Summary

## What was built
- **`packages/web-client/src/features/files/molecule-source.ts`** (new) — the pure `{ url, name }`
  source derivation, in its own module specifically so it has **no** runtime import of
  `@molviewer/core`. Deviation from the draft (which put this function inside `MoleculeViewer.tsx`
  itself): merely importing `@molviewer/core` executes module-scope code that touches `document`
  (confirmed via a failing test run — `ReferenceError: document is not defined` from a transitive
  dependency), so a test importing the pure helper from the same file as the `MolViewer` import
  would drag in and execute the whole viewer bundle. Splitting the file is what makes "unit-test
  only the pure part... do not mount `<MolViewer>` in Vitest" actually achievable.
- **`packages/web-client/src/features/files/MoleculeViewer.tsx`** (new):
  - `MoleculeViewerProps { path: string | null; isActive?: boolean; onModifiedChange?: (modified:
    boolean) => void }`.
  - `import "@molviewer/core/style.css"` at module scope (rides the lazy `vendor-molviewer` chunk).
  - `useFileDownload(path ?? "", Boolean(path))` — empty tabs perform no RPC (`enabled: false`).
  - Render states: spinner (`path` set, download pending) → muted `Error: …` line (download error
    **or** `onLoadError`, same inline state) → `<MolViewer>`.
  - `source` via `moleculeSource(path, download.data?.objectUrl)`.
  - `sourceMode`: `hasLoadedRef.current ? "update" : "replace"`, flipped to `true` in `onLoad`. A
    mounted `MoleculeViewer` corresponds to exactly one tab for its whole lifetime (task-004 mints a
    new tab id per path), so the ref never needs resetting mid-lifetime.
  - `onModifiedChange` passed straight through to the prop of the same name, for task-007's gate.
  - `onLoadError` wired into the same error display as a download failure (api.d.ts's `LoadEvent`
    interface — `system`/`atomCount`/… — confirms `onLoad` only fires on success, so this is a
    correct 2-callback split, not a guess).
  - `useRef<MolViewerHandle>(null)` kept as the escape hatch, per the task.
- **`packages/web-client/src/features/files/MoleculeViewer.module.css`** (new) — the
  `height: 100%; min-height: 0;` chain from `FilePanel.module.css`, plus a `flex: 1; min-height: 0;`
  class passed as `<MolViewer className>` so the WebGL canvas fills the panel.
- **`packages/web-client/src/features/files/MoleculeViewer.test.ts`** (new) — 4 tests against
  `moleculeSource`: null path, no object URL yet (both `undefined` and `null`), basename derivation,
  and the no-separator fallback. (Named `MoleculeViewer.test.ts` per the task's own test plan —
  task-007 adds `shouldApplyRefresh` cases to this same file.)

## The `[VERIFY]` hidden-tab resize item
Grepped the **installed** `node_modules/@molviewer/core/dist/molviewer.js` for `ResizeObserver`:
Molstar's `InputObserver` attaches its own `ResizeObserver` directly to the canvas's container
element (two call sites, both `typeof window.ResizeObserver < "u" && (V = new
window.ResizeObserver(Ke))` inside the input-handling module) — the same self-correcting mechanism
`TerminalPanel` gets from its own explicit `resizeObserver.observe(containerRef.current)`
(`TerminalPanel.tsx:227-230`), except molviewer does it internally rather than needing a host-side
effect. Source inspection strongly suggests it self-corrects on becoming visible without any
`isActive`-keyed re-fit from this component. **Not yet visually confirmed** — task-003 alone has no
route to mount a molecule tab in the running app (panel/tab wiring is task-004's scope). Kept
`isActive` as an accepted, wired-through prop (`data-molecule-active` attribute on the wrapper) so a
manual re-fit effect can be added here later with no interface change if the live check in
task-004's manual smoke test or task-010's E2E shows otherwise.

## The `vendor-molviewer` chunk acceptance bullet — deferred, as expected
Re-ran `npm run build:web-client` after adding `MoleculeViewer.tsx`: **no** `vendor-molviewer-*.js`
chunk is emitted yet. This is correct, not a miss — Rollup only chunks modules that are actually
reachable from an entry point, and nothing reachable imports `MoleculeViewer.tsx` until task-004
wires it into `panel-registry.ts`'s lazy `PANEL_BY_KIND`. The task-003 draft's phrasing of this
bullet assumed the module would already be in the graph; it isn't, by this task's own explicit
"Out of scope: tab kind, panel registration, and entry points (task-004)." Re-verified as the
correct next check point in task-004's summary instead.

## Verification
- `npx vitest run packages/web-client/src/features/files/MoleculeViewer.test.ts` — 4/4 pass.
- `npm run typecheck` — passes (`tsc -b`, no errors); this does typecheck `MoleculeViewer.tsx`
  itself even though nothing yet imports it (the package's `tsconfig` includes all of `src`).
- `npm run build:web-client` — succeeds; confirmed no `vendor-molviewer` chunk (see above).
- `npx oxlint` on all three new files — zero issues.

## Acceptance criteria
- [x] `path: null` renders `<MolViewer>` with no source and performs no file RPC (`useFileDownload`'s
      `enabled` arg is `Boolean(path)`).
- [x] A supported file renders its structure; spinner while in flight, muted error line on failure
      (download error or parse error, same display).
- [x] First load uses `sourceMode="replace"`; subsequent source changes use `"update"`.
- [~] Viewer fills its panel via the `FilePanel.module.css`-style height chain — CSS-verified; visual
      confirmation (including the hidden-tab-and-back case) deferred to task-004's manual step, since
      no tab exists yet to mount it in.
- [x] `@molviewer/core/style.css` imported from this module only, not a global entry.
- [~] `vendor-molviewer-*.js` chunk — correctly absent at this stage (see above); the criterion is
      re-checked once task-004 wires the panel.
- [x] `npm run build:web-client` and `npm run typecheck` pass.

## Follow-up for task-004 / task-010
- Wire `MoleculeViewer` into `panel-registry.ts` and re-verify the `vendor-molviewer` chunk appears.
- Visually confirm the hidden-tab resize behavior (switch tabs away and back) once a molecule tab
  exists; if Molstar's internal `ResizeObserver` does *not* self-correct in practice, add an
  `isActive`-keyed effect here (dispatching a `window` resize event, per the task's suggested lever)
  — the `isActive` prop and `data-molecule-active` attribute are already in place for it.
