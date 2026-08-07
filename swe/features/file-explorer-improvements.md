# File Explorer — Improvements Requiring a Tech Scope + Sprint

> Companion to `features/file-explorer-quick-wins.md` — the two halves of one 2026-07-30 triage
> split, both now under `features/`. These items from the same user report did **not** fit a
> single PR: each needed a new daemon capability (an unvalidated `HandlerRegistry` handler,
> matching this surface's existing convention — not a `packages/protocol` schema; none of the four
> file-mutation RPCs have one) and/or non-trivial client state design when triaged. Neither is
> true of what's left: item 8
> shipped in sprint 046, and the sole remaining item — item 9's rename — needs **zero daemon
> work** (`file_move_request` already covers it). This report identifies *why* each item was out
> of quick-win scope and what a scoping pass would need to resolve — it deliberately does **not**
> design the sprint/task breakdown; that's a separate planning pass (`clean-room-plan` skill).

## Daemon file surface — status

> **Status (2026-08-03): item 8 is done, and with it the last daemon capability this report
> needed.** This section originally carried a blocking constraint ("there is still no rename,
> move, or copy RPC"); that constraint no longer applies to anything here. Sprint 046
> (`sprints/sprint-046-file-explorer-move/`, all six tasks in `done/`) shipped
> `file_move_request`: `FileExplorerService.moveEntry` in
> `packages/server/src/files/file-explorer.ts` — an `fs.rename`-shaped move-or-rename with every
> rejection decided server-side (`empty_path`, `invalid_name`, `not_found`, `not_a_directory`,
> `same_path`, `into_descendant`, `exists`, `cross_device`) and **parent-only** symlink
> resolution so a symlink moves as the link, not its target. A same-parent destination is a
> rename, so no second RPC is ever needed for that — which is why item 9's rename is now
> client-only. Scope doc: `features/file-explorer-move.md`. The daemon's file surface exposes:
> `file_explorer_request` (list/read, 256 KiB preview cap), `file_read_request` (inline text
> read, 5 MiB cap — a distinct, unrelated ceiling from `file_explorer_request`'s preview),
> `file_create_request` (create-exclusive, non-recursive), `file_delete_request`,
> `file_write_request` (overwrite-only — powers the molecule viewer's Save button, see
> `packages/web-client/AGENTS.md`), `file_move_request`, and binary upload/download frames.
> Nothing remaining in this report needs a further daemon addition.

---

## 8 — Support drag and drop (move files/folders in the tree)

~~Flagged by the user as "probably not a quick win" — confirmed. Requires:~~

> **Done (sprint 046, `sprints/sprint-046-file-explorer-move/`, all six tasks in `done/`)**.
> Shipped end-to-end: daemon `file_move_request` with eight server-side rejections and
> parent-only symlink resolution (`file-explorer.ts:174-241`, scope doc
> `features/file-explorer-move.md`); client `move-entry.ts` wire helper + error map; pure
> `resolveMoveTarget` drop-legality (`move-target.ts`); `explorer-store.repathAfterMove`;
> draggable rows + 700 ms auto-expand + drop handler with dual-directory invalidation and
> tab close/reopen (`FileExplorer.tsx`). Two known follow-ups worth carrying into item 9's
> rename scope: the server trims the destination basename when *validating* (`moveEntry`,
> `destName = basename(inputDestination).trim()`) but joins the **untrimmed** basename into
> the destination path — a name with leading/trailing whitespace passes validation and lands
> on disk as-is. The create path's `TreeDraftRow` trims client-side; a rename editor must do
> the same (or the server should trim). Second: `moveDropped` computes the destination
> client-side (`resolveMoveTarget`) and uses that computed path for cache invalidation,
> `repathAfterMove`, and tab reopening — it never reads `moveEntry`'s own returned
> `destination` (`move-entry.ts:36`), which can differ from the requested path if a symlinked
> destination ancestor resolves elsewhere. A shared move/rename call site should use the
> daemon-returned destination consistently instead.

- ~~**New daemon capability**: a move/rename RPC with a collision policy (overwrite? reject?
  merge-into for directory-into-directory?), and a decision on cross-directory vs same-directory
  moves.~~ Shipped — collision is a hard `exists` error; never overwrite, never merge.
- ~~**dnd-kit wiring over a virtualized tree**: the explorer is rendered through
  `@tanstack/react-virtual` (`FileExplorer.tsx`) with lazy per-directory expansion — drop-target
  detection has to work across virtualized rows, including auto-expanding a collapsed directory
  hovered during a drag (a UX behavior VS Code has that users will expect), and disallowing
  invalid drops (dropping a directory into its own descendant).~~ Shipped (native HTML5 DnD over
  the virtualizer, not dnd-kit — the existing upload drop zone was extended with an
  `application/x-pi-studio-path` MIME type; see sprint 046 task-005).
- ~~**Optimistic UI vs round-trip**: whether the tree updates before or after the daemon confirms
  the move, and how that interacts with `use-explorer-watch.ts`'s live file-tree subscription
  (which may also report the same change via `file_changed`, risking a double-update).~~ Resolved:
  no optimistic update — the move round-trips, both directories' listings are invalidated, and
  `use-explorer-watch`'s `file_changed` pushes refetch the same keys (TanStack Query dedupes).

## 9 — Rename

> **Done (sprint 047, `sprints/sprint-047-file-explorer-rename/`, all six tasks in `done/`)**.
> Shipped exactly as scoped below: daemon `moveEntry` now joins the *trimmed* destination
> basename (task-001, closing the leading/trailing-whitespace gap noted under item 8); a shared
> `applyMove` helper (task-002) is the single post-move/rename reconciliation path, honouring the
> daemon-echoed destination and folding the closed-diff-tab count into the status line instead of
> closing them silently; `explorer-store.renaming` (task-003) and `file-tree.ts`'s row-
> substituting `RenameRow` (task-004) hold the in-place editor state without touching the create
> draft; `TreeRenameRow.tsx` (task-005) is the pre-filled, extension-aware inline editor,
> committing through `applyMove`; and the row context-menu's `Rename` entry (task-006) is the
> **only** trigger — no F2, no `tabIndex`/`onKeyDown` on `TreeNode`, exactly as decided below.
> Both Decision blocks below were implemented as written, not revisited.

Distinct from the quick-win subset of item 9 (Open, Copy Absolute Path, Copy Relative Path —
pure client, shipped in `features/file-explorer-quick-wins.md`). Cut/copy/paste of files has been
removed from this report and is no longer a tracked improvement item anywhere; the quick-wins
report's "out of scope" list no longer points here for copy-on-disk. Rename is all that
remains:

- **Rename**: ~~same missing move/rename RPC as item 8's move~~ **the RPC exists now** —
  `file_move_request` handles same-parent rename (the scope doc's own `## Purpose` already
  anticipates this: "by drag-and-drop today and by an explicit rename affordance later").
  Rename is now **client-only**: reuse `move-entry.ts` and the `moveDropped` post-op sequence
  (`FileExplorer.tsx:168-198` — status line, invalidate both affected `rpcKeys.explorer(...)`,
  `repathAfterMove`, tab close/reopen) wholesale, fixing the destination-echo gap noted in item
  8 above while at it. Caveats from triage (2026-08-03):
  - `resolveMoveTarget` **rejects same-parent drops** (`destinationDir === dirOf(sourcePath)` →
    null) — correct for drag, fatal for rename, so it must not be reused; rename validation is
    entirely server-side (`moveEntry`).
  - **Decision (2026-08-03): an open diff tab on the moved/renamed path closes and does NOT
    reopen — but the status line must say so.** Today it closes *silently*:
    `closeByPathPrefix` (`tab-store.ts:205-212`) matches `file`/`diff`/`molecule`, while
    `moveDropped`'s reopen check tests only `file`/`molecule` (`FileExplorer.tsx:184-187`).
    Reopening was rejected on verified git behavior: renaming a *modified* tracked file leaves
    ` D old` + `?? new`, so the diff handler's primary `git diff -- <new>` returns empty and its
    `--no-index` fallback (`bootstrap.ts:469`) renders the **entire file as added lines** — a
    reopened tab would replace the user's real "what did I change" view with an all-green
    whole-file diff. That's git's model, not a rendering bug (`git diff` on one path cannot do
    rename detection; that needs a whole-diff `-M` against the deleted counterpart, which the
    per-path handler never runs). So the defect to fix is the silence: count matching diff tabs
    *before* `closeByPathPrefix` and fold the count into `moveDropped`'s existing status line
    (e.g. `Moved to sub — closed 1 diff tab`). No `openDiffTab` helper is needed (none exists;
    diff tabs are minted elsewhere). Repathing stays rejected — tab ids embed the path
    (`diff-${path}${staged}`), which is why sprint 046 chose reopen-over-repath. One rule for
    drag and rename, single-sourced at the shared call site; descendant diff tabs under a
    renamed *directory* keep closing per `features/file-explorer-move.md` § UI Behavior, and the
    same count covers them.
  - `explorer-store`'s draft model is create-shaped (`{parentPath, kind}`) — a rename editor
    needs the original path instead. `TreeDraftRow` is also create-specific in placement, not
    just data: `flattenTree`/`pushChildren` *inserts* it as a new row at the top of its parent's
    children (`file-tree.ts:77-85`), it never *replaces* an existing row. An in-place rename
    editor needs either row substitution in the flattening logic or a `TreeNode`-level edit mode
    — reusing the draft component as-is is not enough.
  - **Decision (2026-08-03): rename is triggered from the row context menu only — no F2
    shortcut.** This drops the row-level keyboard work entirely: rows stay plain non-focusable
    `<div>`s (`TreeNode.tsx`), with no `tabIndex`, no `onKeyDown`, and no new entry in
    `use-shortcuts.ts`. Add a "Rename" item to `FileContextMenu`'s **row** variant only — the
    `background: true` empty-space variant has no specific row to act on. `remove()`
    (`FileContextMenu.tsx:106-128`) is the nearest precedent for wiring a row mutation, and
    placing Rename directly above Delete matches that menu's existing "mutations last" grouping.
    Note this removes *row-level* keyboard handling only: the inline editor still needs
    Enter-to-commit / Escape-to-cancel / blur-to-dismiss, which `TreeDraftRow` already implements
    locally (`TreeDraftRow.tsx:35-46`) and a rename editor inherits from that same pattern.

---

## Status (2026-08-03 update)

Both items this report tracked are now **complete**. Item 8 shipped in sprint 046 (daemon +
client). Item 9's rename shipped in sprint 047
(`sprints/sprint-047-file-explorer-rename/`, summarized above) — client-only, zero daemon RPC
additions beyond task-001's trimmed-basename fix, exactly as scoped: the context-menu-only
trigger (no F2), the diff-tab close-and-report behavior, the shared `applyMove` reconciliation,
and the daemon-echo fix all landed as decided. Item 5 (text-file editing) and item 9's
cut/copy/paste remain removed from this report — neither is a tracked improvement item. Nothing
in this report is open work anymore; it is now a closed record, kept for the decision rationale
(the two Decision blocks under § 9) and as the scoping history sprint 047's tasks cite.

One triage gap to reconcile before the next planning pass: the original 2026-07-30 user list was
numbered 1–12, and **item 10 appears in neither this report nor report 1** (which covers 1, 2,
3, 4, 6, 7, 9-partial, 11, 12). Either it was dropped silently or the numbering skipped — worth
checking against the source list.
