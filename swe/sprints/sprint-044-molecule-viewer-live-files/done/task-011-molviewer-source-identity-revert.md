# Task 011 — Stop every re-render from reloading the molecule and reverting in-viewer edits

- **Sprint:** sprint-044-molecule-viewer-live-files
- **Status:** done — user-verified live
- **Type:** bugfix
- **Depends on:** task-007 (`useFileWatch` + gated reload — the code this regressed in)
- **Size:** S (two lines of code; the diagnosis was the work)

## Why

Reported live, long after the sprint closed: molviewer's own editing input "is not always
registered — sometimes works, sometimes doesn't". The decisive detail came in the second report:

> when I choose an atom and hit delete, the atom disappears and then quickly appears again […] when
> running molviewer as a standalone component outside pi-studio the atom is deleted

That reframes the bug completely. Nothing was swallowing the event: the edit **landed** and was then
**reverted by a reload**. The initial suspicion (the split-panes work broke event delivery) was
investigated and cleared — `.dropZone` is `pointer-events: none`, hidden panels are `display: none`,
`layout-store.focusPane` already no-ops when the pane is unchanged, `use-shortcuts.ts` never touches
Delete/Backspace, and `MoleculeViewerPanel`'s `isActive` is inert (it only sets a
`data-molecule-active` attribute that no CSS selects on).

The actual cause is a prop-contract violation in our wrapper. `@molviewer/core` treats `source` as a
**load trigger keyed on object identity** — `MolViewer.tsx`'s own comment says so:

```tsx
// ---- source prop: loaded whenever this value's identity changes (Step 4f) -----
useEffect(() => {
  if (source) void load(source, { mode: sourceMode ?? 'replace' });
}, [source]);
```

and an `update`-mode load re-parses the file and dispatches `UPDATE_SYSTEM`, replacing the structure.
It deliberately preserves camera, selection and `status` (`useLoadSource.ts` skips `LOAD_START` for
`update` so the overlay never covers a good structure), which is exactly why this presents as a
silent revert rather than as a visible reload.

`MoleculeViewer.tsx` called `moleculeSource(path, download.data?.objectUrl)` **inline during render**,
and `molecule-source.ts` returns a fresh `{ url, name }` literal on every call. So every re-render
handed molviewer a new identity — i.e. issued a reload command.

The loop is self-triggering, which is what produced the "sometimes":

1. Delete an atom → the reducer applies it → the atom visibly disappears.
2. The viewer becomes dirty → `onModifiedChange(true)` fires (molviewer emits it on the clean↔dirty
   **transition** only, `MolViewer.tsx`'s `wasModified` guard).
3. Our handler calls `setModified(m)` → **React re-render**.
4. New `source` object identity → the `[source]` effect re-fires → `load(…, { mode: 'update' })`.
5. The file is re-parsed from the object URL → `UPDATE_SYSTEM` → **the deleted atom is back**.

So the failure has a precise period, not random behaviour:

| Action | `modified` transition? | Re-render? | Outcome |
|---|---|---|---|
| First edit after a load or a save | false→true | yes | **reverts** |
| Second, third… edit | none (already dirty) | no | sticks |
| Save, then edit again | false→true again | yes | **reverts** |

Dragging an atom is an edit too, so it took the identical path — the atom snapped back, which reads
as "the mouse event was not registered".

**Where split-panes came in.** It is an amplifier, not the origin: any unrelated re-render reverted a
pending edit too, and sprint-049 multiplied them. `TabPanelHost` re-renders on *every* layout-store
mutation and renders all panels as direct children of one `tabs.map` with no `React.memo`, so pane
focus clicks, splits, tab moves — and every per-frame `resizeDivider` during a divider drag — re-render
every mounted panel. With an unmemoized `source` that meant one full fetch-and-re-parse of the
structure **per `pointermove` frame**. Sprint-049 task-002 also switched this panel from reading
`tab-store.activeTabId` to `useIsTabVisible(tab.id)`, subscribing it to layout-store as well.

## Change

`packages/web-client/src/features/files/MoleculeViewer.tsx` — memoize the source so its identity
changes only when the bytes do:

```tsx
const objectUrl = download.data?.objectUrl ?? null;
const source = useMemo(() => moleculeSource(path, objectUrl), [path, objectUrl]);
```

`objectUrl` is destructured to a **string** on purpose, so the dependency compares by value rather
than on react-query's `data` object identity.

Live reload is preserved by construction and needs no special case: `download.refetch()` mints a new
object URL, so the string changes, the memo recomputes, the identity changes, and molviewer reloads —
which is precisely the one situation that should reload. The unsaved-edit gate
(`shouldApplyRefresh` in `molecule-reload.ts`) is untouched.

Deliberately **not** changed, and left as a separate concern: the panel re-render storm itself.
Memoizing at the panel boundary would stop layout churn from reaching every panel subtree (a divider
drag currently re-renders every chat timeline and terminal too). That is a perf change affecting all
five panel kinds, it is no longer a correctness issue once `source` is stable, and it deserves its own
task rather than riding along with a two-line bugfix.

## Acceptance

- [x] Deleting an atom keeps it deleted — the first delete after a load no longer reverts.
- [x] The second and subsequent deletes behave identically to the first (previously the only ones
      that worked, which is what disguised the bug as intermittent).
- [x] Saving and then editing again still keeps the edit (the case that re-armed the revert).
- [x] Dragging an atom leaves it where it was dropped.
- [x] Dragging a pane divider with a molecule open neither flickers nor reloads the structure
      (previously one fetch + re-parse per `pointermove` frame).
- [x] Clicking between panes does not reload the structure.
- [x] Live reload still works: touching the file on disk externally refreshes the viewer, and is
      still gated by unsaved in-viewer edits with the "File changed on disk" badge.
- [x] **Live:** user-confirmed against the production daemon (`daemon/main.js`, real
      `~/.pi-studio`, port 6767) with the vite dev server serving the fix — "issues seems to be fixed".

## Verification

- `npx tsc -b packages/web-client --force` clean (`--force` deliberately: an incremental
  `typecheck` is unproven after a signature change, see sprint-049 task-009).
- `npm run build:web-client` ✓ built in 7.65s.
- `npx vitest run packages/web-client` — **688 passing (51 files)**, no regressions.
- `npx oxlint packages/web-client/src/features/files/` clean; `npx oxfmt --check` clean on the
  touched file.
- No new automated test: the bug lives in a React render/effect interaction inside a `.tsx`
  component, and this package has no jsdom (the root vitest runner discovers only `.test.ts` under
  node), so it cannot be reproduced in this suite. `molecule-source.ts` is already pure and already
  correct — it was never the problem; *when* it is called is. The observable contract is now recorded
  in `clean-room-scope/features/workspace-ui.md` § Molecule viewer behavior and as an invariant in
  `packages/web-client/AGENTS.md`.

## Notes for whoever hits this class of bug next

`molstar`'s input gating is worth knowing before suspecting event delivery again, since it looks like
lost input but is not: keyboard listeners are attached to **`window`** while pointer listeners are on
the **canvas**, the keydown gate is `event.target === document.body || event.target === canvas`, and
the `isInside` flag is recomputed **only on `pointermove`** as "pointer within the canvas'
`getBoundingClientRect`". Its `mask` option defaults to `() => true` and molviewer does not override
it. So molviewer keyboard shortcuts legitimately require the pointer to be hovering the canvas with
no other element holding DOM focus — none of which was the cause here, but all of which looks like it.

The molviewer source is checked out alongside this repo at `../molviewer` — read
`src/ui/MolViewer.tsx`, `src/ui/hooks/useLoadSource.ts` and `src/ui/state/store.ts` rather than the
minified `node_modules/@molviewer/core/dist/molviewer.js`.

---

Written after implementation, so this file is its own summary — unlike tasks 001-010, which were
specified up front and have a separate `-summary.md`.
