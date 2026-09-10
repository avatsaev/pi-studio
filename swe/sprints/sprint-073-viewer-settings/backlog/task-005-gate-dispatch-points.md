# Task 005 — Gate the five molviewer dispatch points + replay ordering

- **Sprint:** sprint-073-viewer-settings
- **Status:** backlog
- **Type:** feature
- **Area:** packages/web-client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004

## Goal

With molviewer disabled, a molecule file opens as text everywhere it can be opened, the two
molecule menu entries disappear, and a persisted molecule tab reopens as a text tab — with the
layout replay waiting for settings to be hydrated so that last part is deterministic.

## Context / why

This is the kill switch's actual behavior. "Disabled" means **don't offer this viewer** — never
"hide the file", never "destroy state". Every gate therefore falls back to the text viewer, and no
path is left where a `.cif` becomes unreachable.

The replay ordering is the one subtle piece: `reopenClientTabs` runs off a connection-gated effect,
and the settings fetch is a round trip. Without an extra condition, a persisted `molecule:<path>`
identity races the fetch and reopens as a molecule tab even when the viewer is off. One more
condition on an existing gate — not a new mechanism.

`tabFromIdentity` must stay a **pure synchronous function** (it is the deliberate inverse of
`tabIdentity` and is unit-tested with no stores). So the predicate is injected as a parameter, not
read from a module global. A hidden global read is not purity; it is coupling to another module's
storage format with no signature to show for it. The same parameter survives unchanged into phase 3,
where the plugin registry supplies it.

## Scope references

- `docs/MOLVIEWER_DECOUPLING.md` § 5 Phase 0 step 2 (:464-482), § 7 semantics table (:663-665),
  § 9 risk row (replay ordering at :731)
- `packages/web-client/src/features/files/open-file-tab.ts:16-19` — `openFileTab` dispatch
- `packages/web-client/src/features/workspace/reopen-client-tabs.ts:34` (`reopenClientTabs`),
  `:48` (`tabFromIdentity`), `:62-70` (the `molecule:` branch)
- `packages/web-client/src/features/files/FileContextMenu.tsx:184-190` — the two menu items
- `packages/web-client/src/features/workspace/TabStrip.tsx:197-199` — "New molecule view"
- `packages/web-client/src/hooks/use-pane-layout.ts:57-64` — the replay gate
- `packages/web-client/src/hooks/use-external-pane-drop.ts` — verify only, no change

## What to build

1. **`open-file-tab.ts`** — `openFileTab` calls `openTextTab` unconditionally when
   `isViewerEnabled("molviewer")` is false.

2. **`reopen-client-tabs.ts`** — `tabFromIdentity(identity, workspaceCwd, isViewerEnabled)` gains a
   third parameter of type `(id: string) => boolean`. When the `molecule:` branch matches and the
   predicate is false, return **exactly** the tab the `file:` branch would produce for the same path
   (`kind: "file"`, `tabIds.file(path)`) — not a molecule tab, not `null`. `reopenClientTabs` passes
   the module-level predicate from the settings store.

3. **`FileContextMenu.tsx`** — hide both "Open in MolViewer" (:184) and "Open as Text" (:188) when
   disabled. "Open as Text" goes too: it only means anything while the viewer exists as the
   alternative, and leaving it would name a viewer the user just turned off.

4. **`TabStrip.tsx`** — hide "New molecule view" (:197) in the `+` menu when disabled.

5. **`use-pane-layout.ts`** — the replay effect's guard becomes
   `status !== "open" || !loaded || replayedRef.current`, where `loaded` comes from the settings
   store. The effect must **re-run when `loaded` flips**, so subscribe to it (hook selector) and add
   it to the dependency array — a `getState()` read inside the existing `[status]` effect would
   never fire again. `replayedRef` still guarantees exactly one replay.

6. **`use-external-pane-drop.ts`** — verify only. Its dual-id lookup is about tabs already open, not
   new dispatch, so it needs no gate. Confirm with a manual drag that dropping an already-open
   molecule tab still focuses rather than duplicates; note the result in the task summary.

## Out of scope

- Any settings UI to flip the toggle (task-006). Test this task by seeding the store directly.
- Closing or converting **already-open** molecule tabs when the viewer is disabled — an open tab
  keeps working (§ 7: "disabled" never destroys state). Only new dispatch and reopen are gated.

## Acceptance criteria

- [ ] Disabled + click a `.cif` in the explorer → a text tab opens; the file is readable.
- [ ] Disabled + persisted `molecule:<path>` identity → reopens as a **file** tab with the file
      tab's id, and the layout's pane placement still resolves.
- [ ] Enabled → all four behaviors are byte-identical to today (no drift).
- [ ] Disabled → neither molecule context-menu item and no "New molecule view" entry is rendered.
- [ ] Replay does not run while `loaded === false`; flipping `loaded` to `true` runs it exactly
      once, and a later `status` churn does not run it again.
- [ ] An already-open molecule tab keeps rendering after the viewer is disabled.

## Test / verification plan

- Tests: `packages/web-client/src/features/workspace/reopen-client-tabs.test.ts` — every existing
  `tabFromIdentity(identity, CWD)` call gains a `() => true` stub (behavior unchanged), plus new
  cases with `() => false` asserting the molecule identity yields the file tab shape. Do **not**
  have these tests read the settings store.
- Tests: a `use-pane-layout` replay test asserting no replay at `loaded: false`, exactly one after
  the flip, and none on a second `status` transition.
- Run: `npx vitest run packages/web-client` — all pass.
- Manual (dev daemon + browser): with the store seeded disabled via the console
  (`useViewerSettingsStore.setState(...)`), open a `.cif` from the explorer → text tab; reload with a
  persisted molecule tab → text tab; re-enable and reload → molecule tab returns. Then the drag
  check from step 6.

## Notes

- Pre-hydration UI may briefly offer a viewer that is about to be reported disabled (the context
  menu and `+` menu are not gated on `loaded`). That is accepted, explicitly: the window is one RPC
  round-trip and it errs toward offering a viewer rather than hiding one. Only the **replay** waits,
  because that one writes persisted layout state.
- Keep the predicate parameter required (not optional with a `() => true` default). An optional
  parameter would let a future caller silently skip the gate.
