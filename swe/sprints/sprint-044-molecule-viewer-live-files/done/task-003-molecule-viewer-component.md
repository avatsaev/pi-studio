# Task 003 — `MoleculeViewer` component (fetch + mount `<MolViewer>`)

- **Sprint:** sprint-044-molecule-viewer-live-files
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001

## Goal
One component that mounts `<MolViewer>` for both cases: a file-backed molecule tab (fetch the file,
hand molviewer its bytes) and an empty molecule tab (no source — molviewer's own drag-drop
empty state).

## Background / why
Verified molviewer API surface (`node_modules/@molviewer/core/dist/types/ui/api.d.ts`):
- `MolViewerProps.source?: MolViewerSource | null` where `MolViewerSource` includes
  `{ url: string; name?: string }` (api.d.ts:20-22) — so the **object URL** `useFileDownload`
  already produces can be handed over directly; no manual `TextDecoder` step and no new fetch hook.
- `sourceMode?: 'replace' | 'update'` (api.d.ts:228-234): `'replace'` resets settings + refits the
  camera (correct for a first load); `'update'` swaps geometry only, preserving camera, settings,
  selection (when atom count is stable), periodic box and active tool (correct for a reload of the
  same file). **`'update'` also clears undo history and resets the modified flag.**
- `onModifiedChange?: (modified: boolean) => void` (api.d.ts:272-274) fires only on the clean↔dirty
  transition; `MolViewerHandle.isModified()` (api.d.ts:211) is the imperative equivalent.
- `MolViewerHandle.update(source)` (api.d.ts:190) is sugar for `load(source, { mode: 'update' })`.
- `ui.emptyState` renders molviewer's own `FirstRunCard` when no source is loaded (verified in its
  `MolViewer.tsx:739`) — the empty tab needs **no** pi-studio UI.

Content is fetched through `useFileDownload` (`packages/web-client/src/hooks/use-file-download.ts`),
**not** `useFileRead`: `file_read_request` caps the inline path (512 KiB today at
`bootstrap.ts:472-473`, raised to 5 MiB by task-009 — either way below real MD trajectories) and
returns UTF-8 **text**, while the chunked binary transfer path has no cap and is byte-exact. That
holds regardless of task-009's ordering, so this decision does not depend on it. Signature verified:
`useFileDownload(path: string, enabled = true)` (line 22), the second arg feeding TanStack Query's
own `enabled` (line 39). It returns `{ objectUrl, mimeType, fileName }` with
`staleTime: Infinity`/`gcTime: 0` and revokes the previous object URL when superseded or on unmount
(lines 46-61) — exactly the lifecycle the reload path in task-007 needs.

## Scope references
- `docs/molviewer-integration-scope.md` § 2.3 (fetch path), § 2.10 (mount lifecycle), § 2.11 (empty
  state), § 3.1, § 4.3
- `clean-room-scope/features/file-explorer-transfer.md` § file preview
- `clean-room-scope/architecture/design-system.md` § tokens
- `packages/web-client/AGENTS.md` § features/files

## What to build
- **`packages/web-client/src/features/files/MoleculeViewer.tsx`**:
  ```ts
  export interface MoleculeViewerProps {
    /** Absolute path of the file to render, or null for an empty ("New molecule view") tab. */
    path: string | null;
    /** True when this viewer's tab is the visible one (see the resize note below). */
    isActive?: boolean;
  }
  ```
  - `import "@molviewer/core/style.css";` at module scope (this module is lazy-loaded, so the CSS
    rides the `vendor-molviewer` chunk rather than the initial bundle). Verified safe to import
    alongside pi-studio CSS: molviewer's stylesheet is class-prefixed and defines its tokens on its
    own root, not on bare global selectors.
  - `const download = useFileDownload(path ?? "", Boolean(path));` — the hook's second arg is its
    `enabled` flag, so an empty tab performs no RPC.
  - Render states: `download.isPending` (with a `path`) → existing `Spinner` primitive;
    `download.isError` → inline muted error line reusing the styling conventions of the sibling
    viewers (`TextViewer.tsx`/`BinaryFallbackViewer.tsx` — match, don't invent); otherwise
    `<MolViewer …/>`.
  - `source`: `path && download.data ? { url: download.data.objectUrl, name: baseNameOf(path) } :
    null`. `name` is load-bearing — molviewer resolves the format from its extension
    (api.d.ts:12-13).
  - `sourceMode`: `"replace"` for the first load, `"update"` afterwards. Track with a ref/state flag
    set in `onLoad`, so a *reload of the same file* (task-007) preserves the camera while the initial
    load still refits it. Do not hardcode `"update"`.
  - `onModifiedChange`: store in component state and **expose it upward** — task-007 gates reloads on
    it. Keep the state here and accept an optional `onModifiedChange?: (modified: boolean) => void`
    prop so the panel/parent can observe it too.
  - Keep a `useRef<MolViewerHandle>(null)` on the component even if the reload path ends up driven by
    the `source` prop — `isModified()`/`update()` are the escape hatch task-007 may need.
  - Sizing: the root must fill the panel. Follow `FilePanel.module.css`'s height chain
    (`height: 100%; min-height: 0;` on every flex ancestor) and pass `className`/`style` to
    `<MolViewer>` (both are supported props, api.d.ts:244-245). A WebGL canvas in a zero-height box
    renders nothing — verify visually, not just by reading CSS.
  - **`[VERIFY]` hidden-tab resize:** `TabPanelHost` never unmounts inactive tabs — it renders them
    all and toggles a CSS-module class (`TabPanelHost.tsx:69`, `.panel{display:none}` /
    `.active{display:flex}` in `TabPanelHost.module.css`), and a hidden element reports a zero-size
    layout box. `features/terminal/TerminalPanel.tsx:246-249` handles this with an `isActive`-keyed
    re-fit (`isActive` computed at line 78 as `activeTabId === tab.id`). Check whether Mol\*
    self-corrects on becoming visible (its `RenderEngine` interface exposes no `resize()` — grep
    confirmed). If it does **not**, fix it here with the `isActive`-keyed effect (dispatching a
    `window` resize event is the least invasive lever if Mol\* listens for it) — **never** by
    remounting, which would destroy camera/selection/undo state. Record the observed behavior in the
    task summary either way.

## Out of scope
- Tab kind, panel registration, and entry points (task-004).
- Live reload on file change (task-007) — this task ships the first-load path only.
- Theme bridging between pi-studio tokens and molviewer's CSS variables. Molviewer ships a dark
  theme that reads acceptably next to pi-studio's; `MolViewerProps.theme` (a
  `Record<string, string>` of CSS custom properties, api.d.ts:246-247) is the documented lever if a
  follow-up wants it. Do not invent variable names.
- Any "Save"/write-back action (`exportFile()` exists but is a separate feature).

## Acceptance criteria
- [ ] `path: null` renders `<MolViewer>` with no source and performs **no** file RPC; molviewer's own
      empty state is visible.
- [ ] A supported file renders its structure; the spinner shows while the download is in flight and a
      muted error line shows on failure.
- [ ] The first load uses `sourceMode="replace"` (camera refits to the structure); subsequent source
      changes use `"update"`.
- [ ] The viewer fills its panel with no clipping or zero-height canvas, and is correctly sized after
      switching away to another tab and back.
- [ ] `@molviewer/core/style.css` is imported from this module (not from a global entry), and
      `npm run build:web-client` emits a `vendor-molviewer-*.js` chunk that is **not** in the initial
      script tags.
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- Unit-test only the pure part: if `baseNameOf`/the source-shape derivation is extracted as a pure
  helper, assert it produces `{ url, name }` with the correct basename (and `null` for a null path).
  Run `npx vitest run packages/web-client/src/features/files/MoleculeViewer.test.ts`.
- Do **not** mount `<MolViewer>` in Vitest — it is a WebGL/canvas component and jsdom has no WebGL
  context. If a component test is added at all, `vi.mock("@molviewer/core")`.
- Visual verification is the real proof and is covered end-to-end in task-010 (needs the tab wiring
  from task-004).

## Notes
- `maxFileBytes` defaults to 64 MB inside molviewer (api.d.ts:240-241) — relevant once real
  trajectories are opened; leave at the default and note it if a large file is rejected.
- `onLoadError`/`onLoadProgress` exist (api.d.ts:255-259) — wiring `onLoadError` into the same inline
  error line as the download failure is cheap and worth doing (a parse failure is as user-visible as
  a fetch failure).
