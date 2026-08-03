# Task 006 — Context-menu "Rename", end-to-end browser verification, docs sync

- **Sprint:** sprint-047-file-explorer-rename
- **Status:** done
- **Type:** feature
- **Area:** web-client / files + docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-005

## Goal
Expose Rename in the row context menu — the single trigger that makes the whole path live — then
prove the affordance in a real browser against a real daemon and sync the docs.

## Context / why
Tasks 001-005 leave a complete but dormant rename path: state, row substitution, editor, and commit
are all in place, with nothing calling `startRename`. This task adds that one call, verifies the
result, and closes item 9 in the improvements report.

**Recorded decision (`features/file-explorer-improvements.md` § 9): the context menu is the *only*
trigger — no F2.** Rows stay plain non-focusable `<div>`s; no `tabIndex`, no `onKeyDown`, no
`use-shortcuts.ts` entry. This removes *row-level* keyboard handling only — the editor's own
Enter/Escape/blur handling ships in task-005.

## Scope references
- `clean-room-scope/features/file-explorer-improvements.md` § 9 (remaining) — Rename, both
  **Decision (2026-08-03)** blocks
- `clean-room-scope/features/file-explorer-move.md` § Purpose, § UI Behavior
- `packages/web-client/src/features/files/FileContextMenu.tsx` — `startNew` (130-135) is the handler
  precedent; the row variant's `Delete` item is at 209-212; the `menu.background` variant is 143-162
- `packages/web-client/AGENTS.md` — source layout + explorer behaviour sections

## What to build

**1. The menu item** — `FileContextMenu.tsx`, **row variant only**:

- Add a `Rename` `MenuItem` immediately **above** the existing `Delete` item, inside the same
  trailing group, so the menu keeps its established "mutations last" grouping. Rename is not
  `danger`; Delete stays the only red entry.
- Icon: `Pencil` from `lucide-react` at `size={13}`, matching every sibling item.
- Handler mirrors `startNew` (130-135): guard `if (!menu) return`, `closeFileMenu()`, then
  `startRename(menu.path)`.
- Applies to **both** files and directories — unlike `Download`/`Open`, it is not wrapped in a
  `!menu.isDirectory` guard.
- The `menu.background` (empty-space) variant gets **nothing**: it has no row to act on.

**2. Docs sync** (required by the repo's docs-on-code-change rule):

- `packages/web-client/AGENTS.md` — add `TreeRenameRow.tsx` and `move-status.ts` to the files source
  layout; document the rename affordance (context-menu only) and the diff-tab close-and-report
  behaviour in the explorer section.
- `clean-room-scope/features/file-explorer-move.md` — § Purpose currently reads "by drag-and-drop
  today and by an explicit rename affordance later"; update it to reflect that the affordance has
  landed, and record in § UI Behavior that a diff tab on the moved/renamed path closes and is
  reported rather than reopened.
- `clean-room-scope/features/file-explorer-improvements.md` — mark § 9 rename as shipped in sprint
  047 (same closed-record treatment item 8 got), leaving the two Decision blocks intact as the
  rationale trail.

## Out of scope
- F2 / keyboard shortcuts / row focus (excluded by decision).
- Cut / copy / paste of files, and copy-on-disk: removed from the improvements report and untracked.
- Multi-select or batch rename.
- Any daemon change — task-001 is the sprint's only server edit.

## Acceptance criteria
- [ ] The row context menu shows `Rename` directly above `Delete`, for both files and directories.
- [ ] The empty-space (background) context menu does **not** show `Rename`.
- [ ] Selecting `Rename` closes the menu and turns that row into the pre-filled editor.
- [ ] `TreeNode.tsx` has no `tabIndex` and no `onKeyDown`; `use-shortcuts.ts` is unchanged.
- [ ] All eight browser checks below pass.
- [ ] The three docs listed above are updated; no doc claims F2 exists or that diff tabs reopen.

## Test / verification plan

Gates — all must pass from the repo root:

- `npm run build` succeeds.
- `npm run typecheck` succeeds.
- `npm run lint` succeeds (zero warnings).
- `npm test` succeeds (full Vitest suite).

**Browser verification** — run the daemon (`npm start`) and the web client, open a workspace with a
git repo, and confirm each:

1. **Happy path.** Rename a file → row becomes an editor with the name pre-filled and the extension
   excluded from the selection; Enter → the row shows the new name in place, and the status line
   reads `Renamed to <new>`.
2. **Open file tab follows.** With the file open in a tab, rename it → the tab reopens at the new
   path with the new label.
3. **Diff tab reports.** With a *modified* tracked file open in a **diff** tab, rename it → the diff
   tab closes and the status line reads `Renamed to <new> — closed 1 diff tab`.
4. **Collision.** Rename to an existing sibling's name → status shows
   `An item with that name already exists in the destination folder.` and nothing moves.
5. **Escape.** Start a rename, type, press Escape → no request is sent and the row reverts.
6. **Unchanged.** Start a rename, press Enter without editing → no request is sent, editor closes.
7. **Directory.** Rename an **expanded** directory → the row renames, its children remain visible
   and expanded, and tabs on descendant files close (diff descendants included in the count).
8. **Whitespace.** Rename to a name with a trailing space → the entry lands **trimmed** (task-001),
   and the tree shows the trimmed name.

Check the browser console for errors after each step, and confirm the tree reflects reality after a
manual refresh (both affected directories were invalidated).

## Notes
- Check 3 is the sprint's most important assertion: it is the one behaviour that was previously
  silent, and the recorded decision turns it into visible, deliberate feedback.
- Check 7 exercises `repathAfterMove` — if expanded state is lost, the store wiring regressed.
- If any check fails, leave this task in `in_progress/` with a `## Blocker` section rather than
  marking the sprint done.
