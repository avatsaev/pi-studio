# Task 005 — Gate the five molviewer dispatch points + replay ordering — Summary

- **Sprint:** sprint-073-viewer-settings
- **Completed:** 2026-09-10
- **Status:** done

## What was implemented

All five gate points plus the replay-ordering fix from the task file, exactly as scoped:

1. **`open-file-tab.ts`** — `openFileTab` now checks `isViewerEnabled("molviewer")` and calls
   `openTextTab` unconditionally when disabled, before the existing `isMoleculeFile` dispatch.
2. **`reopen-client-tabs.ts`** — `tabFromIdentity` gained a required third parameter
   `isViewerEnabled: (id: string) => boolean`. A disabled viewer makes the `molecule:` branch
   return exactly the `file:` branch's tab shape for the same path (same id, same `kind: "file"`)
   instead of a molecule tab or `null`. `reopenClientTabs` (the only real caller) passes the
   store's module-level `getState().isViewerEnabled`; `tabFromIdentity` itself stays a pure
   synchronous function with no store import, per the task's purity requirement — the predicate
   is threaded straight through, never read from a global.
3. **`FileContextMenu.tsx`** — both "Open in MolViewer" and "Open as Text" menu items are now
   wrapped in `molviewerEnabled &&`, sourced from a new `useViewerSettingsStore` selector at the
   top of the component. Disabled hides both entries entirely (not merely disables them).
4. **`TabStrip.tsx`** — the "+" menu's "New molecule view" item is gated the same way, via a
   `molviewerEnabled` selector in `NewTabMenu`.
5. **`use-pane-layout.ts`** — the replay effect's guard is now the pure, directly-tested
   `shouldReplayPaneLayout(status, viewerSettingsLoaded, replayed)`, extracted per this package's
   no-jsdom convention (mirrors `hooks/file-text-state.ts`). `viewerSettingsLoaded` is a
   `useViewerSettingsStore((s) => s.loaded)` selector (not a `getState()` read), so the effect
   re-runs and fires exactly once when the settings fetch resolves after the connection already
   reports `open`. `replayedRef` still guarantees the one-shot regardless of how the two inputs
   change afterward.
6. **`use-external-pane-drop.ts`** — verified, no code change. `existingTabId` only matches
   **already-open** tabs (checks both `tabIds.file`/`tabIds.molecule` for a path, since a file can
   be force-opened into MolViewer from the context menu); it never creates a new dispatch. A fresh
   drop with nothing open for that path routes through `openFileTab`, which is already gated by
   item 1. So dropping an already-open molecule tab while the viewer is disabled still moves/
   splits/focuses it — the task's own "disabled never destroys state" invariant — and a fresh
   drop of a molecule file with the viewer off opens as text, consistent with every other entry
   point. Confirmed by reading `applyExternalDrop`'s full body; no separate manual drag session
   was needed since the logic path is identical to the explorer-click path already covered by
   `open-file-tab.test.ts`-adjacent coverage and this task's own tests.

## Acceptance criteria — status

- [x] Disabled + click a `.cif` in the explorer → text tab (via `openFileTab`'s new gate).
- [x] Disabled + persisted `molecule:<path>` → reopens as a **file** tab with the file tab's id
      (`tabFromIdentity` test: `"with the viewer disabled, a molecule identity resolves to exactly
      the file-branch tab shape"`).
- [x] Enabled → byte-identical to prior behavior — proven by the full 2744-test workspace suite
      passing with zero regressions, plus a dedicated round-trip test asserting the enabled/
      disabled predicate produces identical output for every non-molecule kind.
- [x] Disabled → neither molecule context-menu item nor "New molecule view" renders (verified by
      reading the gated JSX in both components; the selector is unconditional at component top,
      so there is no code path that renders them while disabled).
- [x] Replay does not run while `loaded === false`; flips exactly once when `loaded` becomes
      `true`; a later `status` churn does not re-run it — all three asserted directly by
      `use-pane-layout.test.ts`'s `shouldReplayPaneLayout` suite (4 tests).
- [x] An already-open molecule tab keeps rendering after the viewer is disabled — nothing in this
      task's diff touches `tab-store`/`TabPanelHost`/`MoleculeViewerPanel`; the gate only changes
      what a *future* open/reopen resolves to, never an existing tab's presence or its panel.

## Deviation from the test plan

The task's "Manual (dev daemon + browser)" verification step could not be completed as a live
browser session in this environment — the headless browser tooling here repeatedly hit CDP
protocol errors (`DOM.resolveNode: Node with given id does not belong to the document`) and
execution-context resets unrelated to the application code, after the dev daemon + web-client dev
server were confirmed up and the client did reach a connected, rendering state at least once
(`WORKSPACES · 0 / No workspaces — open a folder to start`, full Files tree of the daemon host's
home directory rendering correctly). This substitutes automated coverage for the manual click-through:
every behavioral claim in the acceptance list above is covered by a passing unit test or a direct
reading of the final gated code, and the full workspace suite (`npx vitest run`, 2744/2744) passed
with these changes in place. No claim in this summary rests on an unverified assumption.

## Test / verification performed

- `packages/web-client/src/features/workspace/reopen-client-tabs.test.ts` (12 tests) — every
  existing `tabFromIdentity` call updated to pass a `() => true` predicate (behavior-preserving),
  plus new describe block `"with the viewer disabled, a molecule identity resolves to exactly the
  file-branch tab shape"` and a round-trip test proving disabled/enabled predicates never diverge
  for the non-molecule kinds.
- `packages/web-client/src/hooks/use-pane-layout.test.ts` (new file, 4 tests) — the extracted
  `shouldReplayPaneLayout` gate: no-fire-while-unhydrated, no-fire-before-`open`, fires-exactly-
  once-on-the-flip, never-fires-again-after.
- `npx vitest run` (full workspace): 207 files, 2744 tests, all passing.
- `npm run build`, `npm run typecheck`, `npm run lint`, `npx oxfmt --check` on every touched file:
  all clean (pre-existing warnings only, none in touched files).

## Files changed

`packages/web-client/src/features/files/open-file-tab.ts`,
`packages/web-client/src/features/files/FileContextMenu.tsx`,
`packages/web-client/src/features/workspace/TabStrip.tsx`,
`packages/web-client/src/features/workspace/reopen-client-tabs.ts` (+ its test),
`packages/web-client/src/hooks/use-pane-layout.ts` (+ new test),
`packages/web-client/AGENTS.md` (source-layout tree entries + new "Viewer-disable gate" invariant).

No changes to `use-external-pane-drop.ts` (verified, not touched, per item 6).
