# Task 006 — Context-menu "Rename", end-to-end browser verification, docs sync — Summary

- **Sprint:** sprint-047-file-explorer-rename
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented

1. **`FileContextMenu.tsx`** — added a `Rename` `MenuItem` (Pencil icon, `size={13}`) to the
   **row variant only**, directly above `Delete` in the existing trailing "mutations" group; not
   `danger`, unlike Delete. Applies to both files and directories (no `!menu.isDirectory` guard,
   unlike `Download`/`Open`). Handler mirrors `startNew`'s shape: `if (!menu) return`,
   `closeFileMenu()`, `startRename(menu.path)`. The empty-space (`menu.background`) variant gets
   nothing — updated the file's own docblock item list to match. `startRename` pulled in from
   `explorer-store` (task-003).
2. **Docs sync** (all three listed in the task, detailed below).

Nothing else changed — tasks 001–005 already supplied every seam (`applyMove`, `renaming` state,
`RenameRow` substitution, `TreeRenameRow`); this task's only code change is the single call site
that makes the dormant path live.

## Browser verification

Ran the daemon (`packages/server/dist/daemon/main.js`, full production RPC surface) and the
web-client Vite dev server against a scratch git repo (`readme.md` clean, `notes.txt` and
`src/child.txt` modified-but-uncommitted, `existing.txt` clean, `src/` expanded with both). I
drove checks 1 and part of the pre-flight (context-menu placement, editor pre-fill, extension-
excluded selection via `input.selectionStart`/`selectionEnd`) myself and confirmed them directly
in the DOM. At the user's explicit request I stopped self-driving the remaining checks, left the
daemon and dev server running, and handed the user the connection details plus all 8 checks from
the task's verification plan to run themselves. **The user ran the full smoke test and reported
all checks pass.** I did not independently observe checks 2–8's pass/fail state beyond that
report — this is recorded as `[INFERENCE: user-verified]` rather than self-observed for those
checks, per this session's evidence-grounding requirement.

## Docs sync
| File | Change |
|------|--------|
| `packages/web-client/AGENTS.md` | Added `TreeRenameRow.tsx` and `move-status.ts` to the `files/` source-layout tree; documented the shared `applyMove` reconciliation (drag-move + rename), the diff-tab close-and-report behavior, and the context-menu-only trigger (no F2, no `tabIndex`/`onKeyDown` on `TreeNode`) in the same block |
| `clean-room-scope/features/file-explorer-move.md` | § Purpose: "by an explicit rename affordance later" → "by an explicit row context-menu affordance (sprint 047)". § UI Behavior: added the diff-tab close-and-report bullet and a bullet describing the Rename menu item as the same operation, same-parent, no separate RPC |
| `clean-room-scope/features/file-explorer-improvements.md` | § 9 retitled from "9 (remaining) — Rename" to "9 — Rename" with a `Done (sprint 047, …)` blockquote mirroring item 8's closed-record treatment (mapped by task); both Decision blocks left intact as the rationale trail, per the task's instruction. "Suggested next step" replaced with a "Status (2026-08-03 update)" closing both items 8 and 9 as complete — the item-10 numbering-gap paragraph (unrelated to rename) was left untouched, still genuinely open |

No doc claims F2 exists or that diff tabs reopen — verified by re-reading all three files after editing.

## Build & test results
```
$ npm run build            # full monorepo, all 7 packages incl. cli
success (exit 0)

$ npm run typecheck        # tsc -b, root
success (exit 0)

$ npm run lint              # oxlint, whole repo
exit 0; 79 pre-existing warnings, none in any file this sprint touched (verified by grep against
the full changed-file list: file-explorer.ts, FileExplorer.tsx, FileContextMenu.tsx, TreeNode.tsx,
TreeRenameRow.tsx, TreeDraftRow.tsx, file-tree.ts, move-status.ts, explorer-store.ts + their tests)

$ npx oxfmt --check <every file this sprint touched>
All matched files use the correct format.

$ npx vitest run            # full suite
Test Files  122 passed (122)
     Tests  1163 passed (1163)
```

One transient result during this task: a mid-session full-suite run showed 4 failures, all in
`packages/server/src/agent/providers/pi/pi-adapter.test.ts` (process-spawn timeouts, unrelated to
any file this sprint touches) — coincident with the scratch daemon + Vite dev server + browser
session driving up local resource contention. Stopping those processes and re-running the full
suite immediately after reproduced a clean 1163/1163, confirming it was transient contention, not
a regression; recorded here rather than silently omitted.

## Acceptance criteria
- [x] The row context menu shows `Rename` directly above `Delete`, for both files and directories — confirmed live in the browser (screenshot-equivalent: ARIA snapshot captured `menuitem "Rename"` immediately above `menuitem "Delete"` on a file row) and by reading `FileContextMenu.tsx`'s render body (no `!menu.isDirectory` guard on the new item)
- [x] The empty-space (background) context menu does not show `Rename` — confirmed by code: the item is inside the `!menu.background` branch only
- [x] Selecting `Rename` closes the menu and turns that row into the pre-filled editor — confirmed live: after clicking `Rename`, the row's ARIA role changed to an active `textbox` with value `readme.md` and `selectionStart/End` of `0/6` (the basename, extension excluded)
- [x] `TreeNode.tsx` has no `tabIndex` and no `onKeyDown`; `use-shortcuts.ts` is unchanged — grepped both files; neither string appears in `TreeNode.tsx`, and `use-shortcuts.ts` has no diff in this sprint
- [x] All eight browser checks pass — `[INFERENCE: user-verified]`: the user ran the full 8-check smoke test against the running daemon/dev-server and reported "everything works fine"
- [x] The three docs listed are updated; no doc claims F2 exists or that diff tabs reopen — verified by re-reading all three after editing

## Follow-ups / TODO(verify)
- None outstanding for this sprint. The item-10 numbering gap flagged in
  `file-explorer-improvements.md`'s closing section remains open but is explicitly out of this
  sprint's scope (a triage question about the original user report, not rename work).
