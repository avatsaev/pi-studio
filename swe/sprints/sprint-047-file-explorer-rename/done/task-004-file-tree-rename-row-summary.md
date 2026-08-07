# Task 004 — `file-tree.ts`: substitute a rename row in place of the edited row — Summary

- **Sprint:** sprint-047-file-explorer-rename
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented

Added `RenameRow` to the `TreeRow` union — `{ kind: "rename", path, depth, name, isDirectory }`,
using the row's **real** filesystem path (unlike `DraftRow`'s synthetic `::draft` key) since a
rename replaces an existing row rather than inserting a new one. Threaded a trailing
`renamingPath?: string | null` positional parameter through `flattenTree` → `pushChildren` →
`pushEntry`, exactly mirroring how `draft` is already threaded.

`pushEntry` now computes `path` and `isDirectory` once, then branches three ways: if
`path === renamingPath`, push a `rename` row instead of `file`/`directory`; otherwise unchanged.
Critically, `isExpanded`/recursion is computed **independently** of which row kind gets pushed, so
a directory being renamed still recurses into its expanded children at `depth + 1` — the row
becomes an editor but the subtree stays exactly where it was, per the task's explicit requirement
("collapsing it would make the tree jump under the user mid-edit").

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/files/file-tree.ts` | modified — `RenameRow` type, `renamingPath` threaded through `flattenTree`/`pushChildren`/`pushEntry`, substitution logic in `pushEntry` |
| `packages/web-client/src/features/files/file-tree.test.ts` | modified — 5 new tests |

## How it satisfies the scope

Implements sprint-047 task-004 against `clean-room-scope/features/file-explorer-improvements.md`
§ 9 (the `flattenTree`/`pushChildren` insertion-vs-replacement caveat). Matches the task's decided
mechanism exactly: substitution in the pure flattening layer, not a `TreeNode`-level edit mode —
`TreeDraftRow`'s hook-free/presentational division of labour for `TreeNode` stays intact. No
deviation from the task file.

## Build & test results
```
$ npx vitest run packages/web-client/src/features/files/file-tree.test.ts
Test Files  1 passed (1)
     Tests  13 passed (13)   # 8 pre-existing + 5 new

$ npm run typecheck        # tsc -b, root
success (exit 0)

$ npx oxlint packages/web-client/src/features/files/file-tree.ts packages/web-client/src/features/files/file-tree.test.ts
clean

$ npx oxfmt --check packages/web-client/src/features/files/file-tree.ts packages/web-client/src/features/files/file-tree.test.ts
clean (ran the scoped auto-fixer once on the new test block, then re-verified --check clean;
diff was whitespace-only)

$ npm run build:web-client
VITE_TARGET=web tsc -b && VITE_TARGET=web vite build — success (exit 0)
```

## Acceptance criteria
- [x] Given a file row and `renamingPath` equal to its path, then that row is replaced by a `rename` row at the same index and depth, and the total row count is unchanged — "substitutes a rename row in place of a file row at the same index and depth" (whole-array `toEqual`, 2 rows before and after)
- [x] Given an expanded directory and `renamingPath` equal to its path, then only its own row is replaced; its children still render at `depth + 1` in the same order — "substitutes only the directory's own row... leaving its expanded children in place"
- [x] The emitted `rename` row carries the row's current `name` and the correct `isDirectory` — asserted in both substitution tests (`isDirectory: false` for the file case, `true` for the directory case)
- [x] Given a `renamingPath` that matches no visible row, then the output is identical to passing `null` — "is identical to passing null when renamingPath matches no visible row"
- [x] Given both a `draft` and a `renamingPath` in the same tree, then both rows render and nothing throws — "renders both a draft row and a rename row together without throwing"
- [x] With `renamingPath` omitted or `null`, output is unchanged — every pre-existing `file-tree.test.ts` expectation passes with no edits — all 8 pre-existing tests pass unmodified; plus an explicit new regression test for the omitted-parameter path

## Follow-ups / TODO(verify)
- None. `renamingPath` is never passed by any caller until task-005 wires `explorer-store`'s
  `renaming` field into `FileExplorer.tsx`'s `flattenTree` call, so this task cannot regress the
  live tree, per its own Notes section.
