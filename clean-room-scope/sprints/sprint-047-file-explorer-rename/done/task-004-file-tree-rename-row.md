# Task 004 — `file-tree.ts`: substitute a rename row in place of the edited row

- **Sprint:** sprint-047-file-explorer-rename
- **Status:** done
- **Type:** feature
- **Area:** web-client / files
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
Teach the pure tree-flattening to **replace** the row being renamed with an editable row — never to
insert an extra one.

## Context / why
The existing `DraftRow` is an *insertion*: `pushChildren` unshifts it at the top of its parent's
children (`file-tree.ts:77-85`) because a create has no row of its own yet. Rename is the opposite
operation — the row exists, and the editor must appear exactly where it already is so the tree
neither grows nor reorders under the user's cursor.

**Decided mechanism: substitution here, in the flattening, not a `TreeNode`-level edit mode.**
`TreeDraftRow`'s docblock pins the existing division of labour — it "owns the input's local text
state so `TreeNode` stays hook-free and presentational". An edit mode would push `useState` into
`TreeNode` and break that; a new row kind in the union keeps every editable row the same shape of
thing and keeps `file-tree.ts` the single place that decides what rows exist.

## Scope references
- `clean-room-scope/features/file-explorer-improvements.md` § 9 (remaining) — Rename (the
  `flattenTree`/`pushChildren` insertion-vs-replacement caveat)
- `packages/web-client/src/features/files/file-tree.ts` — `DraftRow` (47-55), `TreeRow` union (57),
  `pushChildren` (69-99), `pushEntry` (100-117), `flattenTree` (119-130)
- `packages/web-client/src/features/files/file-tree.test.ts` — draft-row coverage at 92-115 is the
  style to mirror

## What to build
Modify: `packages/web-client/src/features/files/file-tree.ts`.

**1. New row type**, added to the `TreeRow` union:

```ts
/** A real tree row replaced in place by its rename editor. `path` and `name` are the row's
 *  *current* values; `isDirectory` keeps the correct icon while editing. */
interface RenameRow {
  kind: "rename";
  path: string;
  depth: number;
  name: string;
  isDirectory: boolean;
}
```

Unlike `DraftRow`, `path` here is the **real filesystem path**, which is what makes it a stable
virtualizer key without a synthetic `::draft` suffix.

**2. Thread `renamingPath`** through `flattenTree` → `pushChildren` → `pushEntry` as a trailing
optional positional parameter (`renamingPath?: string | null`), matching how `draft` is already
threaded.

**3. Substitute in `pushEntry`:** when the computed `path === renamingPath`, push a `rename` row
instead of the `file` or `directory` row it would otherwise push.

For a **directory** being renamed, keep recursing into its expanded children exactly as before. The
row itself becomes an editor; the subtree stays visible and in place. (Collapsing it would make the
tree jump under the user mid-edit.)

## Out of scope
- The editor component and `TreeNode` wiring (task-005).
- Passing `renaming` from the store into `flattenTree` (task-005).
- Any change to `DraftRow`, its synthetic key, or its insertion behaviour.

## Acceptance criteria
- [ ] Given a file row and `renamingPath` equal to its path, then that row is replaced by a
      `rename` row at the **same index and depth**, and the total row count is unchanged.
- [ ] Given an **expanded directory** and `renamingPath` equal to its path, then only its own row is
      replaced; its children still render at `depth + 1` in the same order.
- [ ] The emitted `rename` row carries the row's current `name` and the correct `isDirectory`.
- [ ] Given a `renamingPath` that matches no visible row, then the output is identical to passing
      `null`.
- [ ] Given both a `draft` and a `renamingPath` in the same tree, then both rows render and nothing
      throws — flattening stays a pure function of its inputs even though task-003's store forbids
      the combination.
- [ ] With `renamingPath` omitted or `null`, output is unchanged — every pre-existing
      `file-tree.test.ts` expectation passes with no edits.

## Test / verification plan
- Tests: extend `packages/web-client/src/features/files/file-tree.test.ts` with one case per
  acceptance criterion, asserting whole-array equality in the same style as the existing draft cases
  (92-115) so index and count regressions are caught, not just row shape. Run
  `npx vitest run packages/web-client/src/features/files/file-tree.test.ts`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.

## Notes
- Substitution vs insertion is the whole point of this task — an assertion on row *count* and
  *index* is what actually defends it. A test that only checks "a rename row exists" would pass on a
  buggy insertion.
- This task is inert until task-005 passes `renaming` in, so it cannot regress the live tree.
