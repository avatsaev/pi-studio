# Architecture — Viewer plugin system (phase 1: contract, registry, molviewer move)

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [features/feature-panels-ui.md](../features/feature-panels-ui.md),
> [features/workspace-split-panes.md](../features/workspace-split-panes.md),
> [features/html-file-preview.md](../features/html-file-preview.md) (the *generic* file-viewer
> registry this system deliberately sits beside, not inside),
> [architecture/client-app-runtime.md](client-app-runtime.md)
> Implementation plan: [`docs/MOLVIEWER_DECOUPLING.md`](../../docs/MOLVIEWER_DECOUPLING.md)
> ("the plan" below). The plan owns motivation, the level-2 readiness decisions (§12), and phases
> 0/2/3/4; **this spec owns phase 1 in implementable detail** and records where its boundary was
> moved relative to the plan, and why.

## Purpose

Turn the molecule viewer from a hardcoded member of web-client core into **plugin #1 behind a
general contract**, so that core dispatches through a registry and never names a viewer. Phase 1
delivers the contract, the registry, the host-side panel adapter, and the physical move of the
eight molviewer files — **without touching the persisted tab-identity format**, which is phase 2's
isolated, riskiest change.

Acceptance bar for the whole phase is the plan's **G4**: zero user-visible behavior change. Every
tab, menu entry, live reload, save, and polymer build works exactly as today.

---

## Scope boundary

### In scope (phase 1)

1. `src/viewer-plugins/` infrastructure: `viewer-plugin.ts` (types), `viewer-api.ts` (the plugin
   barrel), `viewer-plugin-registry.ts` (mutable + reactive), `ViewerPanelHost.tsx` (the
   `PanelProps` → `ViewerPanelProps` adapter).
2. The bare specifier `@pi-studio/viewer-api` wired in `vite.config.ts` `resolve.alias` and
   `packages/web-client/tsconfig.json` `paths` (plan §12.3).
3. Move the eight molviewer files to `src/viewer-plugins/molviewer/`, rewriting their core imports
   to the barrel. Viewer logic unchanged.
4. The molviewer descriptor + eager registration through `viewer-plugins/index.ts`, imported once
   from the composition root.
5. Core dispatch generalization that does **not** depend on the tab-kind rename: `openFileTab`,
   `FileContextMenu`, `TabStrip`'s "+" menu / icon / mono-label maps, `use-external-pane-drop`'s
   existing-tab lookup, and the `viewerId` field on viewer tab data.
6. Deletion of `isMoleculeFile` / `MOLECULE_EXTENSIONS` / `MOLECULE_FILENAMES` from
   `features/files/viewer-registry.ts` (moved into the plugin, not re-exported).

### Out of scope

| Deferred to | What |
|---|---|
| Phase 0 (chunk A) | The daemon `viewer_settings_*` family, `viewer-settings-store.ts`, the Viewers settings category, the always-reachable settings gear. **Prerequisite of this phase** — see § Dependencies |
| Phase 2 | `TabKind` `"molecule"` → `"viewer"` rename; `MoleculeTabData` → `ViewerTabData` type rename; `tabIdentity` emitting `viewer:<id>:<path>`; `tabFromIdentity`'s legacy alias; `FileExplorer`'s generic `data.path` reads |
| Phase 3 | Persisted-identity migration + its round-trip tests (lands with phase 2, same PR) |
| Phase 4 | Registry-driven Viewers settings rows, per-plugin `settings.component`, docs sync |
| Phase 5 ([features/viewer-unbound-tabs.md](../features/viewer-unbound-tabs.md)) | Saving an unbound tab to a new file: `SaveAsDialog`, `pickSavePath`, `bindViewerTab`, `writeNewFile`, molviewer's always-on Save. Phase 1 only fixes the lifecycle rules it depends on (§ Tab lifecycle) |
| Level 2 (plan §12.4/§12.5) | Runtime install/uninstall, import map, `@av-pi-studio/viewer-api` package |

### Boundary adjustments vs. the plan (decisions)

The plan's phase-1/phase-2 line is drawn one field too early: the descriptor's `panel` takes
`ViewerPanelProps` (plan §4.1 + §12.6, normative), so core cannot mount a plugin panel at all
until a host adapter exists, and the adapter cannot know *which* plugin owns a tab until tab data
carries a `viewerId`. Everything below follows from that single forcing chain, and each item
exists to avoid writing a literal `"molviewer"` into core.

| # | Decision | Forced by | Effect on phase 2 |
|---|---|---|---|
| D1 | Viewer tab data carries `viewerId` in phase 1 (`{ viewerId: string; path: string \| null }`), while `kind` stays the string `"molecule"` | `ViewerPanelHost` must resolve a plugin from a tab; the alternative is hardcoding the id in core | Phase 2 renames the *type*, not the shape |
| D2 | `FileContextMenu` becomes descriptor-driven now (iterate `enabledViewerPlugins()` for `forceOpen`; "Open as Text" iff `viewerForPath(path)` is defined) | Phase 1 step 5 deletes `isMoleculeFile`, which the menu imports today (`FileContextMenu.tsx:40`); and it must mint tabs with a `viewerId` | Removes plan phase 2 step 4 |
| D3 | `TabStrip`'s "+" menu iterates `emptyTab` descriptors; `tab-store.openNewMolecule` and its module-level `moleculeCount` are deleted, the registry owning per-plugin counters | Same: the "+" menu mints a tab and therefore needs a `viewerId`; `openNewMolecule` would have to hardcode one | Removes part of plan phase 2 step 1 |
| D4 | Tab **ids** are host-minted: `tabIds.viewer(viewerId, key)` → `viewer-<viewerId>-<key>`; `tabIds.molecule` is deleted, and `use-external-pane-drop`'s existing-tab lookup becomes a kind-filtered `data.path` match | Ids are host state and are never persisted (identities are); a plugin minting host ids is exactly the leak the contract exists to prevent | Removes plan phase 2 step 5; the diff-tab hazard the plan's review found is fixed here instead |
| D5 | `ViewerPlugin.emptyTab.mintId(counter)` is **dropped** from the plan's §4.1 contract; only `mintLabel(counter)` remains | Consequence of D4 — with host-minted ids there is nothing for `mintId` to do | Contract is one field smaller |
| D6 | `TabStrip` exports `iconForTab(tab)` / `isMonoLabelTab(tab)` (descriptor-resolved for viewer tabs, `ICON_BY_KIND`/`MONO_LABEL_KINDS` for the rest); `DropPreview.tsx`'s `DragChip` switches to `iconForTab` | Not strictly forced, but leaving `Atom` in core makes `ViewerPlugin.icon`/`monoLabel` dead fields in phase 1. A `Record<TabKind, Icon>` **cannot** express a per-plugin icon, and `DropPreview.tsx:26` indexes that map by kind — so the map has to become a function of the tab, which `DragChip` already has in hand (`DropPreview.tsx:25`) | Removes plan phase 2 step 3 |

Net effect: **phase 2 shrinks to the rename plus the identity format and its migration** — the one
part that can break a persisted layout — instead of mixing that risk with six UI generalizations.
Phase 1 grows by roughly 40 lines spread over four core files, all of them replacing code it
would otherwise have to delete a phase later.

Invariant that makes this checkable: **after phase 1, the only occurrence of a viewer id literal
in core is none at all.** (Phase 2 introduces exactly one, permanently: the `molecule:<path>`
legacy-identity alias in `tabFromIdentity`, per plan §6 rule 2.)

---

## Public contract

### `viewer-plugins/viewer-plugin.ts`

Imports **only** from `react` (type-only). No `@pi-studio-ui/*` import, ever (plan §12.6, guarded
by a source-level test).

| Symbol | Shape | Notes |
|---|---|---|
| `ViewerTabData` | `{ viewerId: string; path: string \| null }` | `path: null` = the plugin's empty ("+"-menu) tab. Replaces `MoleculeTabData` in phase 2; in phase 1 it is the declared shape of a `kind: "molecule"` tab's `data` |
| `ViewerPanelProps` | `{ tabId: string; workspaceCwd: string; path: string \| null; isActive: boolean }` | Everything molviewer's panel reads today. Deliberately **not** the app's `PanelProps`/`Tab` |
| `ViewerSettingsProps` | `{ config: Record<string, unknown> \| undefined; onChange(next: Record<string, unknown>): void }` | Declared in phase 1, consumed in phase 4 |
| `ViewerPlugin` | see below | |

```ts
interface ViewerPlugin {
  id: string;                    // stable, kebab-case; persisted in identities + daemon settings
  apiVersion: number;            // must equal VIEWER_API_VERSION
  label: string;                 // "Molecule Viewer"
  icon: ComponentType<{ size?: number | string }>;
  match(path: string): boolean;  // pure, synchronous, extension/basename tables only
  panel: LazyExoticComponent<ComponentType<ViewerPanelProps>>;
  emptyTab?: { label: string; mintLabel(counter: number): string };
  monoLabel?: boolean;
  forceOpen?: { label: string };
  priority?: number;             // default 100, lower wins on overlapping match()
  settings?: { component: ComponentType<ViewerSettingsProps> };
}
```

`match` and `forceOpen` stay separate capabilities: today's context menu offers "Open in
MolViewer" for *every* file (a LAMMPS `data` file its readers can still parse), while extension
dispatch only claims known formats.

### Tab lifecycle (fixed here, exercised by phase 5)

A viewer tab is **bound** (`path: string`) or **unbound** (`path: null`, opened from the "+"
menu via `emptyTab`). Unbound tabs are first-class — the plan's G6 makes a viewer a file
*creator*, not only an opener — and three rules make that possible without a later redesign:

1. **`path` transitions `null → string` at most once, never back, and a bound tab never changes
   path.** Binding is a host operation (phase 5's `bindViewerTab`); rename/move of a bound file
   goes through the explorer, which closes and reopens tabs as it does today.
2. **The tab id is a birth handle and never changes.** `viewer-<id>-new-<n>` stays on a tab that
   later binds to a path; the panel is not remounted, so in-viewer state (undo, camera,
   selection) survives the bind. The path in a bound-at-birth id is provenance, not a key.
3. **Viewer-tab equality is `(viewerId, data.path)`, never the id.** `openViewerTab` dedupes on
   it before minting (pseudocode below), and `use-external-pane-drop` already matches on
   `data.path` (D4). Without this, opening the just-saved file from the explorer would put a
   second tab on the same path beside the `new-1` one.

The host delivers a bind to the panel as a changed `ViewerPanelProps.path` on the **same mounted
component**. A plugin must treat that transition as "adopt this path for watch/save", not as a
load command — the bytes on disk are what it just serialised, and formats are lossy.

### `viewer-plugins/viewer-api.ts` (the barrel)

The **only** core surface a plugin may import, and only through the bare specifier
`@pi-studio/viewer-api`. Must open with a header comment stating that rule. Exports, all verified
against the moved files' current import lists:

| Group | Exports | Source today |
|---|---|---|
| Data plumbing | `useFileDownload`, `useFileWatch`, `useFileTransfer`, `writeFile`, `WriteFileError`, `createEntry`, `CreateEntryError`, `deleteEntry`, `dirOf` | `hooks/*`, `features/files/*`, `lib/paths.js` |
| Connection | `useConnectionStore`, `type PiStudioClient` | `lib/connection/connection-store.js`, `@av-pi-studio/client` |
| Tab interaction | `openViewerTab` | `viewer-plugin-registry.js` |
| UI primitives | `Panel`, `EmptyState`, `Spinner`, `StatusBadge` | `components/primitives/*` |
| Types | `ViewerPlugin`, `ViewerTabData`, `ViewerPanelProps`, `ViewerSettingsProps` | `./viewer-plugin.js` |
| Versioning | `const VIEWER_API_VERSION = 1` | — |

Two deliberate omissions:

- **`useLayoutStore`** — `MoleculeViewer.tsx:252` reaches into it for exactly one thing:
  `paneOfTab(workspaceCwd, tabId)`, so a built polymer's tab joins the pane the viewer lives in.
  Exposing the layout store to plugins for that leaks the pane tree. `openViewerTab` instead takes
  `opts.fromTabId` and resolves the pane internally. **This is the only call-shape change to
  molviewer during the move**; behavior is identical.
- **`useTabStore` / `tabIds`** — the plan's §4.2 listed them; D4/D5 remove the need. A plugin
  opens tabs through `openViewerTab` and never mints an id.

`write-file.ts` / `create-entry.ts` / `delete-entry.ts` stay in `features/files/` (shared with the
explorer's new-file row and the context menu's delete); the barrel re-exports them.

### `viewer-plugins/viewer-plugin-registry.ts`

| Signature | Behavior | Errors |
|---|---|---|
| `registerViewerPlugin(p: ViewerPlugin): void` | Adds `p`, notifies subscribers | Throws on duplicate `id`; throws on `p.apiVersion !== VIEWER_API_VERSION`, naming both versions |
| `unregisterViewerPlugin(id: string): void` | Removes, notifies subscribers; no-op if absent | — |
| `registeredViewerPlugins(): readonly ViewerPlugin[]` | Registration order | — |
| `enabledViewerPlugins(): readonly ViewerPlugin[]` | Filtered by `isViewerEnabled(id)` | — |
| `viewerForPath(path): ViewerPlugin \| undefined` | First **enabled** plugin whose `match(path)` is true, ordered by `(priority ?? 100, registration order)` | — |
| `viewerById(id): ViewerPlugin \| undefined` | Regardless of enabled state (a disabled-but-open tab must still render) | — |
| `useRegisteredViewerPlugins(): ViewerPlugin[]` | `useSyncExternalStore`; re-renders on register/unregister | — |
| `useEnabledViewerPlugins(): ViewerPlugin[]` | Re-renders on register/unregister **and** settings change | — |
| `openViewerTab(viewerId, path, workspaceCwd, opts?)` | Mints and opens a viewer tab (algorithm below) | Unknown `viewerId` → no-op + `console.warn`; never throws into a render path |
| `openPathInViewer(path, workspaceCwd, targetPaneId?): boolean` | Dispatch; `false` means "no enabled viewer claims this" and the caller falls back to text | — |

`opts` is `{ targetPaneId?: string; fromTabId?: string }`; `targetPaneId` wins when both are given.

### Host-side additions

| Symbol | Location | Shape |
|---|---|---|
| `tabIds.viewer(viewerId, key)` | `stores/tab-store.ts` | `` `viewer-${viewerId}-${key}` ``; replaces `tabIds.molecule` |
| `ViewerPanelHost` | `viewer-plugins/ViewerPanelHost.tsx` | `ComponentType<PanelProps>`; registered as `PANEL_BY_KIND.molecule` in phase 1 (→ `.viewer` in phase 2) |

---

## Behavior & algorithms

### Registration (module scope, synchronous)

```
viewer-plugins/molviewer/index.ts:
    registerViewerPlugin({ id: "molviewer", apiVersion: VIEWER_API_VERSION, ... })

viewer-plugins/index.ts:
    import "./molviewer/index.js"          # eager, side-effecting

src/app.tsx (composition root):
    import "@pi-studio-ui/viewer-plugins/index.js"
```

Eager and synchronous is load-bearing: phase 2's `reopenClientTabs` must resolve viewer identities
at boot, before any connection exists. Only `panel` is lazy — `@molviewer/core` touches `document`
at module scope, so the descriptor module must stay import-safe.

### Open dispatch

```
function openFileTab(path, cwd, targetPaneId):
    if not openPathInViewer(path, cwd, targetPaneId):
        openTextTab(path, cwd, targetPaneId)

function openPathInViewer(path, cwd, targetPaneId):
    plugin = viewerForPath(path)
    if plugin is none: return false
    openViewerTab(plugin.id, path, cwd, { targetPaneId })
    return true

function openViewerTab(viewerId, path, cwd, opts):
    plugin = viewerById(viewerId)
    if plugin is none: warn; return
    pane = opts.targetPaneId
        ?? (opts.fromTabId ? layoutStore.paneOfTab(cwd, opts.fromTabId) : undefined)
    if path is null:
        if plugin.emptyTab is none: return
        n     = ++emptyCounters[viewerId]           # registry-owned, per plugin
        id    = tabIds.viewer(viewerId, "new-" + n)
        label = plugin.emptyTab.mintLabel(n)
    else:
        existing = tabStore.tabs.find(t => t.kind == "molecule"
                                        && t.data.viewerId == viewerId
                                        && t.data.path == path)   # rule 3: equality by data
        if existing: tabStore.activate(existing.id); return
        id    = tabIds.viewer(viewerId, path)
        label = basename(path)
    tabStore.open({ id, kind: "molecule",           # phase 2: "viewer"
                    label, closable: true,
                    data: { viewerId, path }, workspaceCwd: cwd }, pane)
```

`tabStore.open` already treats an unknown pane id as "not supplied" and falls back to the focused
pane, so a `null` from `paneOfTab` needs no special case (today's `openMoleculeTab` relies on the
same property).

### Panel mounting

```
ViewerPanelHost({ tab }):
    { viewerId, path } = tab.data as ViewerTabData
    plugin   = useViewerPlugin(viewerId)        # registry-subscribed; re-renders on unregister
    isActive = useIsTabVisible(tab.id)
    if plugin is none:
        return <Panel><EmptyState>This viewer is not available.</EmptyState></Panel>
    return <plugin.panel tabId={tab.id} workspaceCwd={tab.workspaceCwd}
                         path={path} isActive={isActive} />
```

No local `<Suspense>`: `TabPanelHost.tsx:186` already wraps every panel. The plugin's own
`MolViewerPanel` keeps the `<Panel>` wrapper (imported from the barrel) that
`MoleculeViewerPanel.tsx` owns today, and loses its `useIsTabVisible` call and its `tab.data`
cast — those move into the host, which is the whole point of the adapter.

### Contribution points (descriptor-driven)

| Surface | Rule |
|---|---|
| `FileContextMenu` row menu | One item per `enabledViewerPlugins()` entry declaring `forceOpen`, labelled `forceOpen.label`, glyph `plugin.icon`, action `openViewerTab(plugin.id, path, cwd)`. "Open as Text" renders iff `viewerForPath(path) !== undefined` |
| `TabStrip` "+" menu | One item per `useEnabledViewerPlugins()` entry declaring `emptyTab`, labelled `emptyTab.label`, action `openViewerTab(plugin.id, null, cwd, { targetPaneId: thisPane })` |
| Tab glyph (`iconForTab`, consumed by `TabStrip`'s `TabItem` and `DropPreview`'s `DragChip`) | `tab.kind === "molecule"` → `viewerById(data.viewerId)?.icon ?? File`; other kinds → `ICON_BY_KIND[tab.kind]`, unchanged |
| Mono label (`isMonoLabelTab`) | Viewer tabs: `viewerById(data.viewerId)?.monoLabel === true`; other kinds → `MONO_LABEL_KINDS[tab.kind]`, unchanged |
| `use-external-pane-drop` existing-tab lookup | Any open tab with `kind ∈ { "file", "molecule" }` and `data.path === payload.value`. **Kind-filtered on purpose**: `diff` tabs also carry a `path`, and a path-only match would make dragging a file whose staged diff is open focus the diff instead — a regression today's dual-id lookup cannot have |

### Enabled filter

`enabledViewerPlugins()` and `viewerForPath()` consult phase 0's
`useViewerSettingsStore.getState().isViewerEnabled(id)`, which returns `true` for an absent row and
for the pre-hydration window. `viewerById` deliberately ignores the filter, so an already-open tab
of a just-disabled viewer keeps rendering (plan §7).

---

## Data & persistence touchpoints

| Touchpoint | Phase 1 state |
|---|---|
| Tab `data` for a viewer tab | `{ viewerId, path }` — **new field** (D1) |
| Tab `kind` | Still the literal `"molecule"`; `TabKind` unchanged |
| Tab id | `viewer-<viewerId>-<path>` / `viewer-<viewerId>-new-<n>` (was `mol-<path>` / `mol-new-<n>`). Ids are process-local and never persisted |
| Persisted identity (`tabIdentity`) | **Unchanged**: `molecule:<path>` still written and read. Phase 2 changes it |
| `reopen-client-tabs.ts`'s `tabFromIdentity` | Must mint the new id shape and the new `data` shape for the `molecule:` branch, so a restored tab and a freshly opened one are identical. Stays the literal inverse of `tabIdentity` — no dispatch through `openPathInViewer` |
| Daemon | Nothing. Phase 0 owns `$PI_STUDIO_HOME/viewer-settings.json` |

Because identities do not change, **a layout persisted before phase 1 restores unchanged after
it**, and a downgrade to a pre-phase-1 build also restores unchanged. That property is the reason
for this phase boundary.

---

## File-by-file change list

### New

| File | Contents |
|---|---|
| `src/viewer-plugins/viewer-plugin.ts` | The four types above; imports only `react` |
| `src/viewer-plugins/viewer-api.ts` | Barrel + `VIEWER_API_VERSION`; boundary header comment |
| `src/viewer-plugins/viewer-plugin-registry.ts` | Store, lookups, hooks, `openViewerTab`, `openPathInViewer`, empty-tab counters |
| `src/viewer-plugins/ViewerPanelHost.tsx` | `PanelProps` → `ViewerPanelProps` adapter + not-available fallback |
| `src/viewer-plugins/index.ts` | Eager plugin imports |
| `src/viewer-plugins/molviewer/index.ts` | The descriptor |
| `src/viewer-plugins/molviewer/molecule-formats.ts` | `MOLECULE_EXTENSIONS`, `MOLECULE_FILENAMES`, `isMoleculeFile` relocated from `viewer-registry.ts:132-158`, plus its own 4-line `extOf` — the core copy (`viewer-registry.ts:126`) stays, because `detectViewerKind:170` still needs it and the plugin may not import core internals |

### Moved (logic unchanged, imports rewritten to `@pi-studio/viewer-api`)

`features/files/` → `viewer-plugins/molviewer/`: `MoleculeViewer.tsx`, `MoleculeViewer.module.css`,
`MoleculeViewerPanel.tsx` (→ `MolViewerPanel.tsx`), `molecule-source.ts`, `molecule-reload.ts`,
`molecule-theme.ts`, `polymer-file.ts`, `MoleculeViewer.test.ts`.

### Modified

| File | Change |
|---|---|
| `features/files/viewer-registry.ts` | Delete `MOLECULE_EXTENSIONS`, `MOLECULE_FILENAMES`, `isMoleculeFile`, `extOf`'s molecule-only use if it becomes unused, and the header's "second dispatch path" paragraph |
| `features/files/open-file-tab.ts` | `openFileTab` dispatches through `openPathInViewer`; **delete `openMoleculeTab`**; `openTextTab` unchanged |
| `features/files/FileContextMenu.tsx` | Descriptor-driven force-open items; "Open as Text" gated on `viewerForPath` (D2) |
| `features/workspace/TabStrip.tsx` | "+" menu iterates `emptyTab`; `ICON_BY_KIND`/`MONO_LABEL_KINDS` become module-private behind exported `iconForTab`/`isMonoLabelTab`; drop the `Atom` import and the stale `ICON_BY_KIND` rationale comment (D3/D6) |
| `features/workspace/DropPreview.tsx` | `DragChip` uses `iconForTab(tab)` instead of `ICON_BY_KIND[tab.kind]` (D6) |
| `features/workspace/panel-registry.ts` | `molecule: ViewerPanelHost` (lazy import of the host, which is tiny; the plugin panel stays lazy inside it) |
| `stores/tab-store.ts` | `tabIds.viewer` replaces `tabIds.molecule`; delete `openNewMolecule` + `moleculeCount`; `MoleculeTabData` gains `viewerId` (renamed in phase 2) |
| `features/workspace/reopen-client-tabs.ts` | `molecule:` branch mints the new id + `data` shape |
| `hooks/use-external-pane-drop.ts` | Kind-filtered `data.path` lookup replaces the dual-id lookup (D4) |
| `vite.config.ts`, `tsconfig.json` | `@pi-studio/viewer-api` alias / path |
| `src/app.tsx` | One side-effecting import of `viewer-plugins/index.js` |

`features/files/FileExplorer.tsx` is deliberately **untouched**: its `MoleculeTabData` import and
`kind === "molecule"` checks keep compiling against the phase-1 shape and are phase 2's rename.

---

## Error handling & edge cases

| Condition | Expected behavior |
|---|---|
| Duplicate `id` registered | `registerViewerPlugin` throws at module load — a bundling mistake, fail loudly |
| `apiVersion` mismatch | Throws, naming both versions. In-repo this is a compile-time tautology; at level 2 it is the one check that stops an old bundle |
| Tab whose `viewerId` has no registration (disabled+unregistered, future uninstall) | `ViewerPanelHost` renders the not-available panel. Never a crash, never an empty pane |
| `openViewerTab` with an unknown `viewerId` | No-op + warn |
| `openViewerTab(id, null, …)` for a plugin without `emptyTab` | No-op |
| Two plugins `match()` the same path | Lowest `priority` wins, then registration order. Deterministic, no throw |
| Only matching viewer is disabled | `openPathInViewer` → `false` → the file opens as text. Data is never unreachable |
| Viewer disabled while one of its tabs is open | The tab stays mounted and functional (`viewerById` ignores the filter) |
| A plugin panel throws while rendering | Unchanged from today: the existing panel-level boundary handles it; the host adds no new catch |
| Settings store not yet hydrated | `isViewerEnabled` returns `true` — errs on offering a viewer, never on hiding one |

---

## Dependencies on other specs

- **Phase 0 (plan §4.4 + §5)** — hard prerequisite. The registry's enabled filter reads
  `viewer-settings-store.ts`. If phase 1 is somehow executed first, `enabledViewerPlugins()` must
  be `registeredViewerPlugins()` with a single marked seam, never a second ad-hoc settings source.
- [features/feature-panels-ui.md](../features/feature-panels-ui.md) — the file explorer / preview
  surfaces this dispatch feeds.
- [features/workspace-split-panes.md](../features/workspace-split-panes.md) — `paneOfTab`,
  `targetPaneId`, and the drag-to-pane payload the drop lookup consumes.
- [features/html-file-preview.md](../features/html-file-preview.md) — the generic
  `ViewerKind`/`VIEWER_REGISTRY` table, which stays exactly as it is: it maps a *file kind* to a
  component **inside** `FilePanel`, while a viewer plugin owns its whole tab.
- [features/viewer-unbound-tabs.md](../features/viewer-unbound-tabs.md) — consumes this spec's
  lifecycle rules (stable id, `(viewerId, path)` equality, `path` delivered through props); the
  three barrel additions it makes are its own scope, not this one's.

---

## Acceptance criteria

Behavioral (G4 — verified by manual smoke against a dev daemon, all of it pre-existing behavior):

- [ ] Clicking a `.cif`/`.pdb`/`POSCAR` in the explorer opens the molecule viewer, as today.
- [ ] "Open in MolViewer" appears on **every** file row (including `data.lammps`) and force-opens.
- [ ] "Open as Text" appears only on molecule-recognised rows and opens a text tab beside it.
- [ ] "+" menu → "New molecule view" opens an empty viewer tab labelled `Molecule <n>`, and `<n>`
      still increments across repeats.
- [ ] Editing a file on disk live-reloads the viewer; unsaved in-viewer edits still gate it and
      still surface the "File changed on disk" badge.
- [ ] Save writes back to the same absolute path; polymer build writes beside the monomer and
      opens the result **in the same pane** as the viewer that built it.
- [ ] Dragging a file already open in the viewer onto a pane focuses that tab rather than opening
      a duplicate; a file whose **diff** tab is open opens a fresh file tab instead (D4's guard).
- [ ] Reload with a persisted molecule tab restores it, byte-identical layout, from an identity
      written by a pre-phase-1 build.

Structural:

- [ ] No file under `viewer-plugins/molviewer/` imports `@pi-studio-ui/*`; every core import is
      `@pi-studio/viewer-api`.
- [ ] No file outside `viewer-plugins/molviewer/` imports `@molviewer/core`, and no test imports
      it at all (module-scope `document`).
- [ ] No core file contains a viewer-id string literal.
- [ ] `viewer-plugin.ts` imports only `react`.
- [ ] `vendor-molviewer` remains a separate chunk that loads only when a viewer tab opens.

Gates: `npm run build:web-client`, `npx vitest run packages/web-client`, `npm run typecheck`,
`npm run lint`, `npx oxfmt <changed files>`.

---

## Test plan

Updated:

| Test | Change |
|---|---|
| `features/files/viewer-registry.test.ts` | The `isMoleculeFile` suite moves to `viewer-plugins/molviewer/molecule-formats.test.ts`; the generic registry keeps `detectViewerKind`/`LIVE_REFRESH_KINDS`/`VIEWER_REGISTRY` coverage |
| `stores/tab-store.test.ts` | `openNewMolecule` cases → registry `openViewerTab(…, null, …)` with a fake plugin; id/label conventions asserted against the new shape |
| `features/workspace/reopen-client-tabs.test.ts` | `molecule:` identity still round-trips, now to the new id + `{ viewerId, path }` data |
| `hooks/use-external-pane-drop.test.ts` | Existing reuse cases keep passing; **add** the diff-only case (must not be reused) |
| `MoleculeViewer.test.ts` | Moves with the plugin; pure-helper imports unchanged |

New:

- `viewer-plugin-registry.test.ts` — duplicate id throws; `apiVersion` mismatch throws naming both
  versions; `viewerForPath` priority + registration order; enabled filter reacts to the settings
  store; `unregisterViewerPlugin` notifies subscribers; `openPathInViewer` returns `false` when the
  only match is disabled; `openViewerTab` resolves `fromTabId` to that tab's pane and prefers
  `targetPaneId` when both are given; empty-tab counters are per plugin; **`openViewerTab` with a
  path already held by a differently-id'd viewer tab activates that tab instead of opening a
  second one** (lifecycle rule 3 — the phase-5 bind case, set up with `updateData`).
- `viewer-plugin.test.ts` — source-level guard: the file contains no `@pi-studio-ui/` import (same
  shape as `theme/font-scale.test.ts`).
- `viewer-panel-host.test.ts` — unknown `viewerId` renders the fallback; a registered plugin's
  panel receives exactly `{ tabId, workspaceCwd, path, isActive }`.
- `viewer-api.test.ts` — source-level guard: no file under `viewer-plugins/molviewer/` imports
  `@pi-studio-ui/`.

> Note: the repo has no jsdom environment configured, so component-level assertions
> (`viewer-panel-host.test.ts`) must be expressed against the pure props-derivation function the
> host uses, not a rendered tree — the same split `molecule-source.ts`/`text-viewer-state.ts`
> already use. Extract `viewerPanelProps(tab, isActive)` if that is what it takes.

---

## TODO(verify)

- [ ] Exact settings-store selector name from phase 0 (`isViewerEnabled` assumed here) — align
      before implementing, do not introduce a second accessor.
