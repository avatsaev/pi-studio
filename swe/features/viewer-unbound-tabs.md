# Feature — Viewer unbound tabs become files (phase 5, plan G6)

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [architecture/viewer-plugin-system.md](../architecture/viewer-plugin-system.md)
> (§ Tab lifecycle — hard prerequisite), [file-explorer-transfer.md](file-explorer-transfer.md)
> (`file_create_request`'s exclusive-create semantics, the binary upload stream),
> [workspace-split-panes.md](workspace-split-panes.md) (`paneOfTab`)
> Plan: [`docs/MOLVIEWER_DECOUPLING.md`](../../docs/MOLVIEWER_DECOUPLING.md) § 5 Phase 5

## Purpose

A viewer plugin is usable **without a file** and can **create one** from what the user built in
the empty view. Today the first half exists (the "+" menu's "New molecule view" opens an
*unbound* tab, `path: null`) and the second half is impossible: `MoleculeViewer.tsx` withholds
`onSave` and `onPolymerBuild` when `path` is null, so an unbound molviewer tab draws no Save
button, and a polymer built in one falls back to a browser download because there is no
directory to write beside.

This feature adds the host half — a "where to save" dialog and the tab rebind — as three barrel
additions any plugin can use, and wires molviewer to them. It is the first phase of the plan with
a **deliberate** user-visible change, kept out of phases 1–3 so their zero-behavior-change bar
stays checkable.

Division of labour, fixed:

| Host owns | Plugin owns |
|---|---|
| The path-picking dialog, its validation, and its exclusive-create semantics | Serialisation (`text()`), the format, the suggested file name |
| Writing the bytes (claim → upload → rollback) | Deciding *when* to offer a save (its own Save button) |
| Rebinding the tab: data, label, identity — and therefore persistence | Reacting to the rebind without reloading |

---

## Public contract

### Barrel additions (`@pi-studio/viewer-api`)

| Signature | Behavior | Errors |
|---|---|---|
| `pickSavePath(opts: PickSavePathOptions): Promise<string \| null>` | Opens `SaveAsDialog`; resolves the absolute path the user confirmed, or `null` on cancel/dismiss. One request at a time — a second call while one is pending rejects | Rejects with `Error("A save dialog is already open")` |
| `writeNewFile(client, upload, path, text, mime?): Promise<void>` | Claims `path` exclusively (`file_create_request`, `wx`), then fills it through the binary upload stream; on upload failure deletes the claim and rethrows | `CreateEntryError` (`code: "exists"` when the path is taken); upload errors verbatim |
| `bindViewerTab(tabId: string, path: string): void` | `updateData({ path })` + `updateLabel(basename(path))` on an unbound viewer tab. Id unchanged, no remount | Throws if the tab is not an unbound viewer tab (already bound, wrong kind, or closed) — a programming error, not a user-facing state |

```ts
interface PickSavePathOptions {
  workspaceCwd: string;      // the dialog's default directory
  suggestedName: string;     // e.g. "molecule.mol2" — plugin-chosen, extension included
  title?: string;            // dialog title, default "Save as"
}
```

`writeNewFile`'s `upload` parameter is the `upload(dir, file)` function `useFileTransfer()`
returns, so the helper stays a plain function with no hook dependency and is callable from an
event handler.

### Host-side additions (not exported to plugins)

| Symbol | Location | Shape |
|---|---|---|
| `useUiStore.saveAsRequest` | `stores/ui-store.ts` | `{ options: PickSavePathOptions; resolve(path: string \| null): void } \| null`; set by `pickSavePath`, cleared by the dialog |
| `SaveAsDialog` | `features/files/SaveAsDialog.tsx` | Mounted once beside `OpenWorkspaceDialog`; renders while `saveAsRequest` is non-null |

The dialog is the cwd picker's pattern (`useUiStore.cwdPickerOpen` / `closeCwdPicker`,
`OpenWorkspaceDialog.tsx`) with a promise resolver in the slot instead of a boolean — one
imperative call site per plugin, no dialog-mounting knowledge in plugin code.

### `SaveAsDialog` behavior

| Element | Rule |
|---|---|
| Path field | Single text input, pre-filled `joinPath(workspaceCwd, suggestedName)`; the basename is selected on open (extension excluded, so typing replaces the name and keeps `.mol2`) |
| Accepted input | Absolute (`/…`) or home-relative (`~/…`). `~` is left alone — the daemon expands it (root `AGENTS.md` invariant 7). A relative path is resolved against `workspaceCwd` via `resolveWorkspacePath` |
| Validation (client-side, inline) | Empty, trailing `/`, or a basename of `.`/`..` disables Save with a reason |
| Confirm | `Enter` or the Save button → `resolve(path)`, request cleared |
| Cancel | `Esc`, the Cancel button, or outside click → `resolve(null)`, request cleared |
| Collision | **Not** checked by the dialog. The caller's `writeNewFile` fails with `exists` and the plugin surfaces it; the user re-invokes Save. Exclusive-create is the only arbiter (a directory listing can be stale; the filesystem cannot), and there is deliberately no overwrite path — a new file never clobbers |

---

## Behavior & algorithms

### Save from an unbound tab (plugin side, molviewer)

```
handleSave(e: SaveEvent):                       # onSave is now ALWAYS wired
    if not client: setSaveError("Not connected"); return
    if path is not null:                        # bound: unchanged from today
        writeFile(client, path, e.text()); e.saved(); return

    target = await pickSavePath({
        workspaceCwd,
        suggestedName: (e.fileName ?? "molecule") + "." + extensionFor(e.formatId),
    })
    if target is null: return                   # cancelled — viewer stays modified, no error
    try:
        await writeNewFile(client, upload, target, e.text(), mimeFor(e.formatId))
    except err:
        setSaveError(err.code == "exists" ? `${basename(target)} already exists` : err.message)
        return
    bindViewerTab(tabId, target)                # host: data + label + identity
    e.saved()                                   # viewer flips clean, Save greys out
```

`e.fileName` is `null` for a structure built from nothing (molviewer's own `SaveEvent` doc);
`e.formatId` is the format the viewer will serialise in. For an unbound tab the system's
`sourceFormat` is `"draw"` (`emptyDrawSystem()`), which `defaultExportId` maps to **`"mol"`**
(its `?? "mol"` fallback — verified in `@molviewer/core` 0.4.x's bundle), so the suggested name
is `molecule.mol` and the file carries bonds. `extensionFor` / `mimeFor` are plugin-local
tables keyed by molviewer's export ids (`mol`, `mol2`, `pdb`, `xyz`, `cif`, `gjf`, `gro`,
`poscar`, `xsf`, `lammps-data` → `.data`, `lammpstrj`) — the host never sees a format id.

Molviewer draws the Save button iff `onSave` is passed and enables it while `modified` is true
(`MolViewerProps.onSave`: "Absent, no Save button is drawn"); it does not gate on `fileName`, so
wiring `onSave` unconditionally is sufficient — no `@molviewer/core` change and no host-drawn
Save affordance.

### Polymer build from an unbound tab

```
handlePolymerBuild(e):                          # onPolymerBuild is now ALWAYS wired
    if path is not null: writePolymer(...) as today; open result beside it; return
    target = await pickSavePath({ workspaceCwd, suggestedName: polymerFileName({ monomers: e.monomers }) })
    if target is null: return
    writeNewFile(client, upload, target, e.text(), "chemical/x-mol2")
    openViewerTab("molviewer", target, workspaceCwd, { fromTabId: tabId })
```

The unbound tab itself stays unbound — a build produces a *new* file, it does not name the
monomer. `polymerFileName` gains a `sourcePath`-less form (today it derives the stem from the
monomer's basename; unbound uses a fixed `polymer` stem).

### Reacting to a bind (plugin side)

This is the part `MoleculeViewer.tsx`'s current design contradicts: its `hasLoadedRef` comment
assumes one path per mounted lifetime, and its `source` memo turns any new `path` into a load
command. After a bind the file on disk is the viewer's own serialisation, so reloading it is at
best a flash and at worst lossy (`.xyz` drops bonds). Rule: **a bind adopts the path for
watch/save; the structure in memory is authoritative until an external change arrives.**

```
bornUnbound = useRef(path === null)             # captured at mount

download = useFileDownload(path ?? "", enabled = path !== null && !(bornUnbound && changedAt === null))
watch    = useFileWatch(path)                   # starts on the new path immediately
source   = useMemo(() => bornUnbound && objectUrl === null ? null : moleculeSource(path, objectUrl), [...])
```

Consequences, all required:

- No `Loading…` branch fires on bind (`download` is disabled, so `isPending` is false) — the
  `<MolViewer>` element is never unmounted.
- The first external `file_changed` after the bind is a normal live reload (`shouldApplyRefresh`
  is unchanged; the `modified` gate still protects unsaved edits).
- The save-then-reload loop is still impossible for the same reason `molecule-reload.ts`
  documents: `saved()` runs after the write completes, and the resulting push reloads identical
  bytes with `sourceMode: "update"`.

`hasLoadedRef` is set only by `onLoad`, which an unbound tab never fires until that first
external reload — at which point `"replace"` (camera refit) is correct, because the bytes are
no longer the viewer's own.

### Bind (host side)

```
bindViewerTab(tabId, path):
    tab = tabStore.tabs.find(id == tabId)
    if tab is none or tab.kind != viewer kind or tab.data.path != null: throw
    tabStore.updateData(tabId, { path })
    tabStore.updateLabel(tabId, basename(path))
```

Nothing else moves: the id, the pane, the tab order, the active tab. `tabIdentity` now yields a
path identity for this tab, so the next layout persist writes it and a reload restores it as an
ordinary bound tab with a fresh path-keyed id (identities are what persist; ids are re-minted at
boot — `reopen-client-tabs.ts`).

---

## Data & persistence touchpoints

| Touchpoint | Before bind | After bind |
|---|---|---|
| `tab.data` | `{ viewerId, path: null }` | `{ viewerId, path }` |
| `tab.label` | `Molecule <n>` | `basename(path)` |
| `tab.id` | `viewer-molviewer-new-<n>` | **unchanged** (lifecycle rule 2) |
| `tabIdentity(tab)` | `null` — never persisted | `molecule:<path>` (phase 2+: `viewer:molviewer:<path>`) — persisted on the next layout write |
| `closeByPathPrefix` | Not affected | Closes the tab when its directory is deleted, like any bound tab |
| Explorer | — | `rpcKeys.explorer(dirOf(path))` invalidated after `writeNewFile` so the new row appears |
| Daemon | Nothing new. `file_create_request` + upload stream + `file_delete_request` (rollback) are existing RPCs | |

Unsaved content in an unbound tab is **not** persisted across reload — unchanged from today, and
the Save button is now the answer.

---

## Error handling & edge cases

| Condition | Expected behavior |
|---|---|
| User cancels the dialog | Promise resolves `null`; viewer stays `modified`; no badge, no error |
| Target exists | `writeNewFile` throws `CreateEntryError("exists")` before uploading; plugin shows `"<name> already exists"` as its existing `saveError` badge; tab stays unbound; user re-invokes Save |
| Upload fails after the claim | Claim deleted (best-effort), original error rethrown and shown; tab stays unbound |
| Disconnected at Save | Same `"Not connected — cannot save."` path as today, before any dialog opens |
| Tab closed while the dialog is open | The dialog is app-level; on confirm `bindViewerTab` throws (tab gone) after the file was written. The plugin catches, shows nothing (its panel is unmounted), the file exists on disk and appears in the explorer — no orphan claim, no crash |
| Second `pickSavePath` while one is pending | Rejects; only one dialog exists |
| Path outside the workspace | Allowed — same as the explorer's `~`/absolute handling; the daemon's own path rules apply |
| Viewer disabled after bind | Tab stays mounted (`viewerById` ignores the filter); a reload restores it as text-fallback only if the viewer is still disabled — plan §7, unchanged |
| Bind delivered to a plugin that does not handle path changes | Not possible for molviewer after this feature; for a future plugin, the lifecycle rule in the architecture spec is the contract it must honour |

---

## Dependencies on other specs

- [architecture/viewer-plugin-system.md](../architecture/viewer-plugin-system.md) § Tab lifecycle
  — the three rules this feature exercises. Without rule 3 (`(viewerId, path)` equality) a bound
  `new-1` tab and a fresh explorer click on the same file would coexist.
- [file-explorer-transfer.md](file-explorer-transfer.md) — `file_create_request`'s `wx` open is
  what makes exclusive-create the collision arbiter; the binary upload stream is why
  `writeNewFile` does not use `file_write_request` (5 MiB inline cap).
- [workspace-split-panes.md](workspace-split-panes.md) — `openViewerTab`'s `fromTabId` puts a
  built polymer in the builder's pane.

---

## Acceptance criteria

- [ ] "+" → "New molecule view" → build a structure → Save button is **present and enabled** once
      the viewer reports modified.
- [ ] Save opens a dialog pre-filled with `<workspaceCwd>/molecule.<ext>`, name selected; `Enter`
      writes the file, the tab label becomes the basename, the Save button greys out, the explorer
      shows the new row, and the structure on screen does not flash, refit, or lose undo history.
- [ ] Reload after that: the tab comes back as a bound tab on the same path, same pane.
- [ ] Clicking the saved file in the explorer while the bound `new-1` tab is open **activates it**
      rather than opening a second tab.
- [ ] Saving to a name that exists shows `<name> already exists`, writes nothing, leaves the tab
      unbound and modified.
- [ ] Cancelling the dialog leaves the viewer modified with no badge.
- [ ] Editing the saved file on disk afterwards live-reloads it (bind did not break watching).
- [ ] Polymer build in an unbound tab prompts for a path and opens the result in the same pane;
      the unbound tab stays unbound.
- [ ] A bound tab's Save still writes in place with no dialog.
- [ ] No plugin file imports anything but `@pi-studio/viewer-api` for the above.

Gates: `npm run build:web-client`, `npx vitest run packages/web-client`, `npm run typecheck`,
`npm run lint`, `npx oxfmt <changed files>`.

## Test plan

| Test | Coverage |
|---|---|
| `features/files/write-new-file.test.ts` (new) | Claim → upload order; `exists` short-circuits before upload; upload failure deletes the claim and rethrows the upload error, not the delete's |
| `features/files/save-as-path.test.ts` (new, pure) | Prefill/selection range; validation table; `~`, absolute, and relative resolution against `workspaceCwd` |
| `viewer-plugin-registry.test.ts` | `bindViewerTab` on bound/closed/non-viewer tab throws; on an unbound tab updates data + label and leaves the id; `openViewerTab` then dedupes onto it |
| `stores/tab-store.test.ts` | `tabIdentity` of a bound-later tab equals that of a bound-at-birth tab on the same path |
| `viewer-plugins/molviewer/MoleculeViewer.test.ts` | `polymerFileName` without `sourcePath`; `extensionFor`/`mimeFor` tables; the `download`-enabled predicate as a pure function (`shouldFetchSource({ bornUnbound, path, changedAt })`) — extracted like `shouldApplyRefresh`, since there is no jsdom |

Manual smoke covers the dialog and the no-flash-on-bind criterion; neither is expressible without
a DOM.

## TODO(verify)

- None outstanding. Both `@molviewer/core` questions (Save-button gating, default format for a
  drawn structure) were resolved against the installed package's declarations and bundle
  (`ui/api.d.ts` `onSave`/`SaveEvent`, `core/model/edit.d.ts` `emptyDrawSystem`,
  `defaultExportId`'s fallback). Re-check after a molviewer bump.
