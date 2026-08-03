# Task 005 — `TreeRenameRow` component, render wiring, and the rename commit

- **Sprint:** sprint-047-file-explorer-rename
- **Status:** done
- **Type:** feature
- **Area:** web-client / files
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-003, task-004

## Goal
Render the rename row as an inline input pre-filled with the current name, and commit an accepted
edit through the shared `applyMove` sequence.

## Context / why
Tasks 003 and 004 leave the state and the row shape in place but nothing renders or commits. This
task closes that: the component follows `TreeDraftRow`'s established pattern (owns its own text
state so `TreeNode` stays presentational), and the commit reuses task-002's `applyMove` so rename
and drag share one reconciliation path.

Rename is a **same-parent move**, which is why it must *not* go through `resolveMoveTarget`: that
helper deliberately returns `null` for `destinationDir === dirOf(sourcePath)` — correct for drag
(dropping a row into its own folder is a no-op) and fatal for rename. All rename validation is
server-side in `moveEntry`.

## Scope references
- `clean-room-scope/features/file-explorer-improvements.md` § 9 (remaining) — Rename (the
  `resolveMoveTarget` caveat, the `TreeDraftRow`-inherits-Enter/Escape/blur note)
- `clean-room-scope/features/file-explorer-move.md` § Purpose ("an explicit rename affordance
  later"), § UI Behavior (status line, tab reopen)
- `packages/web-client/src/features/files/TreeDraftRow.tsx` — the pattern to mirror (whole file, 50
  lines; key handling at 35-46)
- `packages/web-client/src/features/files/TreeNode.tsx` — the `row.kind === "draft"` branch at 84-92
- `packages/web-client/src/features/files/FileExplorer.tsx` — `flattenTree` call at 122-125,
  `submitDraft` at 200-212 (the commit shape to mirror), `applyMove` from task-002

## What to build

**1. Create `packages/web-client/src/features/files/TreeRenameRow.tsx`**, structurally mirroring
`TreeDraftRow.tsx` — same `styles.item` row, same `styles.draftInput`, same
`onClick={(e) => e.stopPropagation()}`, same doc-comment voice:

```ts
export interface TreeRenameRowProps {
  name: string;                    // current basename, pre-filled
  isDirectory: boolean;
  indentStyle: CSSProperties;
  onSubmit(name: string): void;    // trimmed, non-empty, and actually different
  onCancel(): void;
}
```

Behaviour:

- `useState(name)` — seeded with the current name, not empty.
- `autoFocus`, and on mount **select the basename without its extension** so a straight re-type does
  not clobber `.ts`. Use a ref + `setSelectionRange(0, idx)` where `idx = name.lastIndexOf(".")`,
  falling back to select-all when `idx <= 0` (dotfiles like `.gitignore`) or when `isDirectory`.
- **Enter** → trim; if empty **or** unchanged from `name`, call `onCancel()`; otherwise
  `onSubmit(trimmed)`. Bailing on unchanged avoids a pointless round-trip that the daemon would
  answer with `same_path`.
- **Escape** → `onCancel()`; **blur** → `onCancel()`. Identical to `TreeDraftRow`, which is where the
  keyboard contract for inline editors already lives.

**2. Wire the row in `TreeNode.tsx`** — a `row.kind === "rename"` branch beside the existing
`draft` branch, rendering `TreeRenameRow`. Add `onSubmitRename(path, name)` and `onCancelRename()`
to `TreeNodeProps`, threaded exactly like the existing `onSubmitDraft`. `TreeNode` gains no hooks.

**3. Pass `renaming` into flattening** — `FileExplorer.tsx:122-125`: read `renaming` from the
explorer store, pass it as `flattenTree`'s new argument, and add it to the `useMemo` dependency
array (omitting it would freeze the tree mid-rename).

**4. Add the commit in `FileExplorer.tsx`**, mirroring `submitDraft`'s shape:

```ts
async function submitRename(path: string, newName: string) {
  cancelRename();
  if (!client) return;
  const destination = joinPath(dirOf(path), newName);   // same parent — no resolveMoveTarget
  setStatus({ text: `Renaming ${path.split("/").pop()}…`, error: false });
  try {
    const { destination: finalPath, closedDiffs } = await applyMove(path, destination);
    setStatus({
      text: withClosedDiffs(`Renamed to ${finalPath.split("/").pop()}`, closedDiffs),
      error: false,
    });
  } catch (err) {
    setStatus({ text: err instanceof Error ? err.message : "Failed to rename", error: true });
  }
}
```

Cancel wires straight to the store's `cancelRename`. For the join, reuse the `dirOf` helper
`moveDropped` already imports plus the same `dir.endsWith("/")` guard `file-tree.ts:65-67` uses —
export that `joinPath` from `file-tree.ts` rather than writing a third copy.

## Out of scope
- The context-menu "Rename" entry — task-006. Nothing sets `renaming` yet, so this task ships a
  complete-but-dormant editor path rather than a stub.
- F2 or any keyboard shortcut, `tabIndex`/`onKeyDown` on `TreeNode`, `use-shortcuts.ts` changes:
  excluded by the recorded decision.
- Multi-select or batch rename.

## Acceptance criteria
- [ ] Given `renaming` set to a file's path, then that row renders as an input pre-filled with the
      current name, with the extension excluded from the initial selection.
- [ ] Given a dotfile (`.gitignore`) or a directory, then the whole name is selected.
- [ ] Given Enter on a changed, non-empty name, then exactly one `file_move_request` is issued with
      a destination in the **same parent directory**.
- [ ] Given Enter on an unchanged or whitespace-only name, then **no** RPC is issued and the editor
      closes.
- [ ] Given Escape or blur, then no RPC is issued and the row reverts to its normal presentation.
- [ ] Given a successful rename, then the status line reads `Renamed to <new name>`, plus the closed
      diff-tab suffix when any were closed.
- [ ] Given a daemon rejection, then the status line shows `moveEntry`'s mapped sentence verbatim and
      the tree is left untouched.
- [ ] `resolveMoveTarget` is not called anywhere on the rename path.
- [ ] `TreeNode.tsx` still declares no hooks.

## Test / verification plan
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Tests: no new unit test file — the pure seams are already covered (task-002's `withClosedDiffs`,
  task-004's flattening, task-003's store), and the remainder is React wiring that the repo verifies
  in the browser, exactly as sprint 046 task-006 did. Run `npm test` to confirm no regression.
- Manual: deferred to task-006, which drives the full affordance end-to-end once the trigger exists.

## Notes
- Extension-aware initial selection is a small touch that decides whether the affordance feels
  native; it is called out as an acceptance criterion so it does not get dropped as polish.
- Keep `submitRename` next to `submitDraft` — the two are siblings and reviewers should see them
  together.
