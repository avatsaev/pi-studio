# Task 003 — `explorer-store`: in-progress rename state

- **Sprint:** sprint-047-file-explorer-rename
- **Status:** done
- **Type:** feature
- **Area:** web-client / stores
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** none

## Goal
Track which single row is being renamed in place, mutually exclusive with the existing create draft.

## Context / why
`packages/web-client/src/stores/explorer-store.ts:35` holds the create draft as
`{ parentPath, kind } | null` — "which directory has an in-progress inline create row, and what kind
it is". Rename is a different question: *which existing row is being edited*. The create shape
cannot answer it (a rename has no `kind` to pick and its parent is implied by the path), so this adds
sibling state rather than overloading `draft`.

Only one inline editor may exist at a time, so the two are mutually exclusive by construction: each
starter clears the other. This is store-level so no component has to coordinate it.

## Scope references
- `clean-room-scope/features/file-explorer-improvements.md` § 9 (remaining) — Rename
  (the `explorer-store` draft-model caveat)
- `packages/web-client/src/stores/explorer-store.ts` — `ExplorerStoreState` (15-48) and the store
  body (50-107)
- `packages/web-client/src/stores/explorer-store.test.ts`

## What to build
Modify: `packages/web-client/src/stores/explorer-store.ts`.

Add to `ExplorerStoreState`:

```ts
/** Absolute path of the row currently being renamed in place, or null. Only one inline editor
 *  exists at a time, so this and `draft` are never both set. */
renaming: string | null;
/** Begin renaming `path`; discards any in-progress create draft. */
startRename(path: string): void;
cancelRename(): void;
```

A bare `string | null` rather than `{ path }`: rename needs exactly one field, and the create
draft's object shape exists only because it carries two.

Wire the mutual exclusion and the lifecycle:

- `startRename(path)` → `{ renaming: path, draft: null }`.
- `startDraft(...)` → also sets `renaming: null` (the inverse guard).
- `setRoot(...)` → also clears `renaming`, exactly as it already clears `draft` (line 64): a
  workspace switch abandons any in-flight editor.
- `repathAfterMove(...)` → also clears `renaming`. The renamed row's old path no longer exists, so
  leaving it set would render an editor against a stale path.
- `cancelRename()` → `{ renaming: null }` and nothing else.

## Out of scope
- Rendering the editor row (task-004 flattening, task-005 component).
- Anything that *calls* `startRename` (task-006's context-menu item).
- Changing `draft`, `selected`, `expanded`, `expandedByRoot`, or `repathAfterMove`'s existing
  rewrite behaviour.

## Acceptance criteria
- [ ] `startRename("/p/a.ts")` sets `renaming` to `"/p/a.ts"` and nulls `draft`.
- [ ] With `renaming` set, `startDraft("/p", "file")` nulls `renaming` and sets `draft`.
- [ ] `setRoot("/other")` nulls both `renaming` and `draft`.
- [ ] `repathAfterMove(from, to, toParent)` nulls `renaming` while its existing `expanded` /
      `expandedByRoot` / `selected` rewriting stays byte-identical.
- [ ] `cancelRename()` nulls `renaming` and leaves `draft`, `expanded`, and `selected` untouched.
- [ ] `renaming` and `draft` are never both non-null through any sequence of the store's actions.

## Test / verification plan
- Tests: extend `packages/web-client/src/stores/explorer-store.test.ts` — one case per acceptance
  criterion, including the "never both set" invariant across an interleaved
  `startDraft`/`startRename` sequence. Run
  `npx vitest run packages/web-client/src/stores/explorer-store.test.ts`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.

## Notes
- This task is inert on its own: nothing reads `renaming` until task-004 and nothing sets it until
  task-006, so it cannot regress the explorer.
