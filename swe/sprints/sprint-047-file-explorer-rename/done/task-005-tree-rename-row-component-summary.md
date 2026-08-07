# Task 005 — `TreeRenameRow` component, render wiring, and the rename commit — Summary

- **Sprint:** sprint-047-file-explorer-rename
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented

1. **`TreeRenameRow.tsx`** (new) — mirrors `TreeDraftRow`'s division of labour: owns local text
   state (`useState(name)`, seeded with the current name) so `TreeNode` stays hook-free. On mount,
   a ref-based `useEffect` focuses the input and `setSelectionRange(0, end)`s the basename without
   its extension (`end = isDirectory || dot <= 0 ? name.length : dot`, so a directory or a dotfile
   like `.gitignore` selects the whole name). Enter trims the value; empty-or-unchanged cancels
   (avoids a round-trip the daemon would only answer with `same_path`), otherwise submits.
   Escape and blur both cancel — identical contract to `TreeDraftRow`.
2. **`file-tree.ts`** — exported the previously-local `joinPath` helper so the rename commit can
   compute a same-parent destination without a third copy of the `endsWith("/")` join logic.
3. **`TreeNode.tsx`** — added `onSubmitRename`/`onCancelRename` to `TreeNodeProps`, threaded them
   exactly like the existing `onSubmitDraft`/`onCancelDraft`, and added a `row.kind === "rename"`
   branch rendering `TreeRenameRow`, beside the existing `draft` branch. `TreeNode` itself still
   declares zero hooks.
4. **`FileExplorer.tsx`** — read `renaming`/`cancelRename` from `explorer-store`; passed `renaming`
   as `flattenTree`'s new trailing argument and added it to the `rows` `useMemo`'s dependency
   array (its omission would freeze the tree mid-rename); added `submitRename(path, newName)`
   beside `submitDraft`, computing the destination via `joinPath(dirOf(path), newName)` — **not**
   `resolveMoveTarget`, which deliberately returns `null` for a same-parent destination (correct
   for drag, fatal for rename: all rename legality is server-side in `moveEntry`) — then
   committing through task-002's `applyMove` and formatting the status line with
   `withClosedDiffs`, mirroring `moveDropped`'s shape.

Nothing calls `startRename` yet (task-006's scope), so this ships a complete-but-dormant editor
path rather than a stub — every seam is wired and testable via `renaming`, but the live tree is
unaffected until task-006 adds the trigger.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/files/TreeRenameRow.tsx` | created |
| `packages/web-client/src/features/files/file-tree.ts` | modified — exported `joinPath` |
| `packages/web-client/src/features/files/TreeNode.tsx` | modified — `rename` branch + prop threading |
| `packages/web-client/src/features/files/FileExplorer.tsx` | modified — store selectors, `rows` memo, `submitRename`, render-site prop wiring |

## How it satisfies the scope

Implements sprint-047 task-005 against `clean-room-scope/features/file-explorer-improvements.md`
§ 9 (the `resolveMoveTarget` caveat, the `TreeDraftRow`-inherits-Enter/Escape/blur note) and
`clean-room-scope/features/file-explorer-move.md` § Purpose/UI Behavior. No deviation from the
task file — `TreeRenameRowProps`, the selection-range fallback rule, the Enter/Escape/blur
contract, and `submitRename`'s body all match the task's sketch verbatim (the only addition is
`isDirectory`/`name` as effect dependencies instead of an empty array, which is the equivalent,
lint-clean way to express "run once for this row" without a suppression comment).

## Build & test results
```
$ npm run typecheck        # tsc -b, root
success (exit 0)

$ npx oxlint packages/web-client/src/features/files/{TreeRenameRow.tsx,TreeNode.tsx,FileExplorer.tsx,file-tree.ts}
$ npx oxfmt --check packages/web-client/src/features/files/{TreeRenameRow.tsx,TreeNode.tsx,FileExplorer.tsx,file-tree.ts}
clean

$ npm run build:web-client
VITE_TARGET=web tsc -b && VITE_TARGET=web vite build — success (exit 0)

$ npx vitest run              # full suite, per the task's verification plan (no new unit test file)
Test Files  122 passed (122)
     Tests  1160 passed (1160)
```

## Acceptance criteria
- [x] Given `renaming` set to a file's path, then that row renders as an input pre-filled with the current name, with the extension excluded from the initial selection — `TreeRenameRow`'s `useState(name)` + selection-range effect
- [x] Given a dotfile (`.gitignore`) or a directory, then the whole name is selected — `isDirectory || dot <= 0` fallback to `name.length`
- [x] Given Enter on a changed, non-empty name, then exactly one `file_move_request` is issued with a destination in the same parent directory — `submitRename` → `joinPath(dirOf(path), newName)` → `applyMove` → `moveEntry` → one `file_move_request`
- [x] Given Enter on an unchanged or whitespace-only name, then no RPC is issued and the editor closes — `TreeRenameRow`'s Enter handler calls `onCancel()` (not `onSubmit`) for `!trimmed || trimmed === name`
- [x] Given Escape or blur, then no RPC is issued and the row reverts to its normal presentation — both wired straight to `onCancel` → `cancelRename()` (store-only, no network call)
- [x] Given a successful rename, then the status line reads `Renamed to <new name>`, plus the closed diff-tab suffix when any were closed — `withClosedDiffs(\`Renamed to ${finalPath.split("/").pop()}\`, closedDiffs)`
- [x] Given a daemon rejection, then the status line shows `moveEntry`'s mapped sentence verbatim and the tree is left untouched — `applyMove` throws before any of its reconciliation steps run (the `moveEntry` call is first), so the `catch` in `submitRename` fires with the thrown message and no cache/store mutation has happened
- [x] `resolveMoveTarget` is not called anywhere on the rename path — `submitRename` uses `joinPath`/`dirOf` only; grepped, `resolveMoveTarget` appears only in `moveDropped`/drag handlers
- [x] `TreeNode.tsx` still declares no hooks — confirmed by reading the file: only `TreeRenameRow`/`TreeDraftRow` (both invoked, not inlined) use `useState`/`useEffect`/`useRef`

## Follow-ups / TODO(verify)
- None. Manual/browser verification of the end-to-end affordance is explicitly deferred to
  task-006, which adds the trigger this task's editor path is dormant without.
