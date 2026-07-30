# File Explorer — Improvements Requiring a Tech Scope + Sprint

> Companion to `1-file-explorer-quick-wins.md`. These items from the same user report do **not**
> fit a single PR: each needs a new daemon capability (protocol schema + server handler, at
> minimum) and/or non-trivial client state design. This report identifies *why* each is out of
> quick-win scope and what a scoping pass would need to resolve — it deliberately does **not**
> design the schemas, RPCs, or sprint/task breakdown; that's a separate planning pass
> (`clean-room-plan` skill) once prioritized.

## Blocking constraint shared by all items below

The daemon's file surface (`packages/server/src/files/file-explorer.ts`) exposes:
`file_explorer_request` (list/read), `file_create_request` (create-exclusive, non-recursive),
`file_delete_request`, `file_write_request` (overwrite-only, added 2026-07-30 — item 5's daemon
piece), and binary upload/download frames. **There is still no rename, move, or copy RPC.** Items
8 and 9-remaining need at least one of those to exist first; item 5's remaining work is
client-only (see below).

---

## 5 — Allow editing of created text files

Currently `CodeView.tsx` renders CodeMirror with `editable={false} readOnly` — display-only by
design. Making files editable is more than flipping that flag:

> **Decision (2026-07-30): the daemon write RPC is built now; the client editing UI is still
> deferred.** `file_write_request` landed (`packages/server/src/files/file-explorer.ts`,
> `FileExplorerService.writeFile`) — overwrite-only (404s `not_found` on a missing target;
> `file_create_request` remains the only path that creates a file), atomic (temp file + `rename`
> over the resolved, symlink-followed target), and capped at `MAX_INLINE_FILE_READ_BYTES` (5 MiB,
> same ceiling `previewFile` reads under) with a `too_large` error above that. No protocol-package
> schema entry, matching every other file RPC in this surface (`file_explorer_request`,
> `file_create_request`, `file_delete_request` are also unvalidated `HandlerRegistry` handlers —
> see root AGENTS.md's per-path-subscription passthrough convention; the same reasoning applies
> here). Everything else below — the dirty-state/conflict model, tab lifecycle, large-file
> streamed-edit path, save shortcut, and `CodeView.tsx` flipping `readOnly` — is still deferred;
> revisit later. Items 8 and 9-remaining (move/rename/cut/copy/paste) are unaffected.

> **Decision (2026-07-30, later same day): the molecule viewer now consumes the write RPC via its
> own Save button — unrelated to this item's CodeView/text-editing scope.** `@molviewer/core`
> shipped `0.4.0` with a new `onSave` prop (Save button in its sidebar header, gated on its own
> internal dirty tracking); `MoleculeViewer.tsx` wires it straight to `file_write_request` via a
> new `write-file.ts` client helper (mirrors `move-entry.ts`'s wire-call-plus-error-mapping shape).
> This did NOT need any of the deferred client-side work below — molviewer owns its own
> dirty-state model and Save-button affordance internally (no `use-file-live-refresh` clobber risk
> either: `MoleculeViewer`'s existing `shouldApplyRefresh` gate already suppresses live reload
> while `modified`), there is no tab-lifecycle close guard (out of scope, not added), and there is
> no keyboard shortcut (the button is molviewer's own UI, not a page-level Ctrl/Cmd+S). Item 5's
> actual subject — `CodeView.tsx`'s text-file editing — is still fully deferred; nothing below
> changes.

- ~~**New daemon capability**: a `file_write_request` (or similar) RPC — protocol schema, server
  handler, and a decision on overwrite semantics (atomic write? truncate vs create-exclusive
  distinction already exists for create — does write need the same care?).~~ Done — see decision
  above.
- **Conflict/staleness**: `use-file-live-refresh.ts` already refetches an open file tab when the
  file changes on disk (`file_changed` push). An editable buffer must not be silently clobbered by
  that refetch mid-edit — needs a dirty-state model that either suppresses live refresh while
  dirty or offers a merge/reload prompt.
- **Tab lifecycle**: a dirty (unsaved) tab needs a visible indicator and a close-time guard
  ("discard changes?"), mirroring the pattern `tab-store.ts`/`closeTab` already uses for
  draft-session discard, but net-new for files.
- **Large-file path**: `use-file-text.ts`'s tier-2 streamed-text fallback (files over the inline
  read cap) would also need to support the edit/save path, or editing could be scoped to
  inline-cap files only — a scoping decision, not an implementation detail. (`writeFile` itself
  already rejects above-cap content with `too_large`, so this decision is now enforced
  server-side either way; a streamed-write RPC would be net-new, not a relaxation of the cap.)
- **Save affordance**: keyboard shortcut (Ctrl/Cmd+S) conflicts/coexistence with existing shortcuts
  (`use-shortcuts.ts` already owns Ctrl/Cmd+T, Ctrl/Cmd+W, Esc) needs to be checked.

The remaining work is client-only (dirty-state model, tab lifecycle, save affordance, scope of
which files are editable) — the cross-package protocol→server piece is done. Still needs a scope
doc before a sprint breakdown once un-deferred.

## 8 — Support drag and drop (move files/folders in the tree)

Flagged by the user as "probably not a quick win" — confirmed. Requires:

- **New daemon capability**: a move/rename RPC with a collision policy (overwrite? reject?
  merge-into for directory-into-directory?), and a decision on cross-directory vs same-directory
  moves.
- **dnd-kit wiring over a virtualized tree**: the explorer is rendered through
  `@tanstack/react-virtual` (`FileExplorer.tsx`) with lazy per-directory expansion — drop-target
  detection has to work across virtualized rows, including auto-expanding a collapsed directory
  hovered during a drag (a UX behavior VS Code has that users will expect), and disallowing
  invalid drops (dropping a directory into its own descendant).
- **Optimistic UI vs round-trip**: whether the tree updates before or after the daemon confirms
  the move, and how that interacts with `use-explorer-watch.ts`'s live file-tree subscription
  (which may also report the same change via `file_changed`, risking a double-update).

Needs its own scope doc for the RPC contract and the drag/drop interaction model before sprint
planning.

## 9 (remaining) — Rename, Cut, Copy, Paste

Distinct from the quick-win subset of item 9 (Open, Copy Absolute Path, Copy Relative Path —
pure client, shipped in report 1). These four need:

- **Rename**: same missing move/rename RPC as item 8's move (a rename is a move within the same
  parent — likely the *same* RPC, which argues for scoping 8 and this together).
- **Cut / Copy / Paste**: needs a clipboard *model* distinct from `lib/clipboard.ts`'s plain-text
  helper (introduced in report 1) — an internal "pending file clipboard" (path + cut-vs-copy mode),
  since:
  - Paste **into the tree** creates/moves a file at the target directory (copy = new daemon
    capability entirely — the file surface has no server-side copy either; move = the same RPC as
    rename/drag-drop).
  - Paste **into text** (e.g. a chat composer, per the user's spec) pastes the absolute path as a
    string — this is actually a browser clipboard interaction, not the internal model, so it may
    only work via the OS clipboard (write the path as text on Copy) rather than the internal
    model — needs a decision on whether "Copy" always writes an OS-clipboard string (path) *and*
    sets internal cut/copy state simultaneously, or whether these are two different affordances
    the user is conflating.
  - Cross-workspace paste (copying a file while workspace A is open, switching to workspace B,
    pasting) raises the same server-side copy question — is a cross-workspace copy just another
    move/copy RPC with an absolute destination, and does the daemon allow writes outside the
    "workspace root" concept the explorer currently enforces client-side?

The clipboard-semantics question (cut vs copy vs "copy path as text") needs to be resolved as a
product decision before scoping the RPC — recommend folding this into the same scope doc as items
5 tech-adjacent write RPC and 8's move RPC, since a single `file_move_request` (+ maybe
`file_copy_request`) likely serves rename, drag-drop, and cut/paste all at once, avoiding three
overlapping RPC designs.

---

## Suggested next step (not executed in this report)

`file_write_request` (item 5's daemon piece) is done. The remaining RPC overlap is items 8 and
9-remaining: a single scope doc covering "file mutation RPCs" (move/rename, copy) followed by one
sprint that lands the protocol/server layer first and then fans out the drag-drop and
rename/cut/copy/paste client features in parallel is likely more efficient than two separate
sprints — but that grouping, the RPC shape, and the task breakdown are exactly what a
`clean-room-plan` pass should produce, not this triage report. Item 5's remaining client-side work
(dirty-state model, tab lifecycle, save affordance) is still deferred until it's un-deferred.
