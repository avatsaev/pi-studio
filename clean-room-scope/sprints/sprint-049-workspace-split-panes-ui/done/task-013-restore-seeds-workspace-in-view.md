# Task 013 — Restore the sidebar/explorer/status bar for the workspace in view, not the newest agent's

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done — user-verified live
- **Type:** bugfix
- **Depends on:** task-009 (`activeWorkspaceCwd` persistence), task-011
- **Size:** M

## Why

Reported: *"the last activated workspace panes are correctly restored, but not correctly opened in the
workspaces sidebar — I think there was a legacy feature that automatically collapses all workspaces and
opens the last active chat's workspace."* Confirmed exactly.

`use-session-restore.ts` derived **three** separate per-workspace facts from `first` = `order[0]`, the
globally most-recently-active agent:

```ts
const targetCwd = normalizeCwd(first.cwd || "~", homeDir);
setCollapsedWorkspaces(collapseInactiveWorkspaces(workspaceGroups, targetCwd)); // sidebar
useSessionStore.getState().activate(first.id);                                  // status bar
useUiStore.getState().setCwd(first.cwd);                                        // file explorer
```

`collapseInactiveWorkspaces`'s own docstring — *"on a fresh connect so only the just-restored workspace
starts expanded"* — dates from before the workspace in view was a persisted fact. "Which workspace was I
looking at" and "which agent was most recently active anywhere" are different questions that happen to
coincide with one workspace open; with two they diverge, and the panes restore into A while the sidebar
sits expanded on B. task-009's `restoreActiveWorkspace` corrected only the *tab view*
(`switchWorkspace`); it never touched `ui-store.collapsedWorkspaces` or `ui-store.cwd`.

## Change

1. **`layout-store.ts`** — new `pendingActiveWorkspace: string | null`, set by
   `installPersistedLayouts(loaded, activeWorkspaceCwd)` (ignoring a cwd whose entry did not survive
   validation), cleared at the hydration settle point alongside the other pending-restore state.
   **Captured, not re-read on demand:** `writePaneLayout` persists `activeWorkspaceCwd` from whatever is
   in view *at write time*, and writes fire throughout the restore window, so re-reading storage later
   can return an already-clobbered target — the same class of bug as task-008's claim-dropping.
2. **`use-pane-layout.ts`** — passes `loaded.activeWorkspaceCwd` into that call (already had it in hand).
3. **`use-session-restore.ts`** — splits the one conflated value in two:
   - `viewCwd = pendingActiveWorkspace ?? firstCwd` → sidebar collapse set + explorer root + the seed
   - `firstCwd` → **stays** the key for task-011's fallback-tab check, which asks whether *`first`'s own*
     workspace has a record to conflict with. Rekeying that on the view target would silently change the
     question and stop opening `first` whenever another workspace had been split.
4. **`restore-active-workspace.ts`** — adopts a chat from the restored workspace as its last step.

## The estimate that was wrong, and why point 4 exists

The status-bar half was scoped as "three lines: seed the active session from `viewCwd` instead of
`first`". That was **falsified by its own test**: the seed is always overwritten, because every
`open()` brings its own workspace into view and re-activates its own chat, and restore opens tabs
immediately afterwards. The seed only survives when no chat tab opens at all.

So the real lever is the settle point — the documented last writer. `switchWorkspace` syncs the active
chat from the focused pane, but `syncActiveSession` deliberately no-ops for a terminal/file tab (a
terminal has no conversation; blanking the status bar would be worse), leaving whatever chat restore
opened last — frequently in another workspace. `adoptChatFromWorkspace` fixes that, and runs even when
the view was already correct, since the view being right says nothing about the active conversation.

This contradicted the plan's stated "not in scope: a second writer for the sidebar". The evidence
changed the answer; the seed is kept (it is strictly better than `first` in the narrow case where it
survives) but it is not what delivers the fix.

## Acceptance

- [x] The sidebar expands the workspace that was in view and collapses the others.
- [x] The file explorer roots at that workspace.
- [x] When the restored workspace's focused pane holds a terminal/file, the active conversation is one of
      *that* workspace's chats, not a foreign one.
- [x] With nothing persisted (fresh install/cleared storage), everything falls back to the previous
      newest-agent behaviour.
- [x] task-011's fallback-tab rule still keys on the newest agent's own workspace.
- [x] **Live:** persisted `activeWorkspaceCwd = …/pi-studio`; after reload `pi-studio` expanded,
      `calculator` (holding the globally newest agent) collapsed, explorer + footer both rooted at
      `~/DEV/avatsaev/pi-studio`, tabs restored. A/B in one session: the cleared-record boot minutes
      earlier expanded `calculator` from the same daemon state.

## Verification

- 11 new tests: 3 in `layout-store.test.ts` (capture, refuse an unvalidated cwd, clear at settle — 49 in
  file), 5 in `restore-hydration.test.ts` (sidebar/explorer follow the view target; fallback when nothing
  persisted; seed in the no-tab case; both task-011 fallback directions — 21 in file), 3 in
  `restore-active-workspace.test.ts` (adopt on switch, adopt when already in view, leave alone when the
  workspace has no chat).
- Full web-client suite **596 passing** (47 files), up from 585, no regressions.
- `tsc -b --force` clean; `oxfmt`/`oxlint` clean on all 7 touched files.
- Two test-authoring bugs caught and fixed by the suite, not shipped: a helper called with an argument it
  does not take, and a case asserting a switch that could not happen because the later `open()` had
  already brought that workspace into view.
