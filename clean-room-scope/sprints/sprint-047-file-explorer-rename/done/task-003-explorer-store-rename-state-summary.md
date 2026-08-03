# Task 003 — `explorer-store`: in-progress rename state — Summary

- **Sprint:** sprint-047-file-explorer-rename
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented

Added `renaming: string | null` to `ExplorerStoreState` alongside `draft` — a bare string rather
than an object, since a rename needs exactly one field (the path) versus `draft`'s two
(`parentPath`, `kind`). Added `startRename(path)` and `cancelRename()` actions, and wired mutual
exclusion + lifecycle exactly per the task spec:

- `startRename(path)` → `{ renaming: path, draft: null }`.
- `startDraft(...)` → now also nulls `renaming` (inverse guard).
- `setRoot(...)` → now also nulls `renaming`, alongside its existing `draft`/`selected` reset.
- `repathAfterMove(...)` → now also nulls `renaming` (the renamed row's old path stops existing).
- `cancelRename()` → nulls `renaming` only.

The store is otherwise byte-identical: `toggle`, `setSelected`, and `repathAfterMove`'s
`expanded`/`expandedByRoot`/`selected` rewriting logic are untouched.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/stores/explorer-store.ts` | modified — `renaming` field, `startRename`/`cancelRename` actions, mutual-exclusion wiring in `setRoot`/`startDraft`/`repathAfterMove` |
| `packages/web-client/src/stores/explorer-store.test.ts` | modified — `renaming: null` added to the shared `beforeEach` reset; new `"explorer store — rename"` describe block, 6 tests |

## How it satisfies the scope

Implements sprint-047 task-003 against `clean-room-scope/features/file-explorer-improvements.md`
§ 9 (the `explorer-store` draft-model caveat: rename needs "which row", not "which directory +
kind"). No deviation from the task file — the field type, action signatures, and every wiring
point match the spec verbatim.

## Build & test results
```
$ npx vitest run packages/web-client/src/stores/explorer-store.test.ts
Test Files  1 passed (1)
     Tests  23 passed (23)   # 17 pre-existing + 6 new

$ npm run typecheck        # tsc -b, root
success (exit 0)

$ npx oxlint packages/web-client/src/stores/explorer-store.ts packages/web-client/src/stores/explorer-store.test.ts
$ npx oxfmt --check packages/web-client/src/stores/explorer-store.ts packages/web-client/src/stores/explorer-store.test.ts
clean (oxfmt initially reflowed the new multi-line `setRoot`/`setSelected` calls — ran the
scoped auto-fixer, re-verified `--check` clean, confirmed the diff was whitespace-only)

$ npm run build:web-client
VITE_TARGET=web tsc -b && VITE_TARGET=web vite build — success (exit 0)
```

## Acceptance criteria
- [x] `startRename("/p/a.ts")` sets `renaming` to `"/p/a.ts"` and nulls `draft` — "startRename sets renaming and nulls any in-progress draft"
- [x] With `renaming` set, `startDraft("/p", "file")` nulls `renaming` and sets `draft` — "startDraft nulls renaming and sets the draft"
- [x] `setRoot("/other")` nulls both `renaming` and `draft` — "setRoot nulls both renaming and draft"
- [x] `repathAfterMove(from, to, toParent)` nulls `renaming` while its existing `expanded`/`expandedByRoot`/`selected` rewriting stays byte-identical — "repathAfterMove nulls renaming while its existing rewrite behavior stays byte-identical" (asserts both the rewritten `expanded`/`selected` and the null `renaming`)
- [x] `cancelRename()` nulls `renaming` and leaves `draft`, `expanded`, and `selected` untouched — "cancelRename nulls renaming and leaves draft, expanded, and selected untouched"
- [x] `renaming` and `draft` are never both non-null through any sequence of the store's actions — "never holds both renaming and draft through an interleaved start sequence"

## Follow-ups / TODO(verify)
- None. `renaming` is unread until task-004 (flattening) and unset by any caller until task-006
  (context menu), so this task cannot regress the explorer, per its own Notes section.
