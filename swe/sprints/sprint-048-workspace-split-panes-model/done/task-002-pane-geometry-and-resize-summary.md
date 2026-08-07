# Task 002 — `pane-tree`: rectangles, dividers, resize, effective tree — Summary

- **Sprint:** sprint-048-workspace-split-panes-model
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented

The geometry half of `pane-tree.ts`: fractional rectangles, divider descriptors, the constrained
divider resize, and the render-time derivation that hides unoccupied panes. All pure arithmetic over
the tree — no pixels, no DOM.

| Export | Contract |
|---|---|
| `MIN_PANE_FRACTION = 0.1` | Resize-only floor (see below) |
| `Rect` | `{ x, y, width, height }` as fractions of the content box |
| `paneRects(tree)` | `Map<paneId, Rect>`; root is `{0,0,1,1}`, splits divide their own rect by `sizes` |
| `SplitPath` | Child indices root → split; the root split's path is `[]` |
| `Divider` | `{ splitPath, boundaryIndex, direction, rect }`; `rect` is a zero-thickness line |
| `dividers(tree)` | N children → N−1 boundaries, each spanning its split's own cross-axis extent |
| `resizeAtDivider(tree, path, boundary, delta)` | Shifts `delta` between the two adjacent siblings, clamped |
| `effectiveTree(tree, occupied)` | The tree as rendered, with unoccupied leaves dropped and collapsed |

Rects stay fractional deliberately: the flat panel host multiplies by one `ResizeObserver`
measurement, so a container resize never re-walks the tree.

The clamp is where the interesting rule lives. Each neighbour's floor is
`Math.min(currentSize, MIN_PANE_FRACTION)`, so:

- a normal pane cannot be pushed below `0.1` — the drag clamps exactly at it;
- a pane **born** below `0.1` (repeated `splitPane` halving) has a floor equal to its own size, so it
  can be grown but never shrunk further.

That is one expression rather than a special case, which is why the minimum stays a resize
constraint and never becomes a global invariant `splitPane` would have to honour.

`effectiveTree` reduces `removePane` over the unoccupied leaves, reusing task-001's collapse — so
the flat-run splice applies at render time too — and, because `removePane` refuses the last leaf, an
entirely unoccupied tree lands on the single-leaf terminal state instead of an empty tree.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/pane-tree.ts` | modified — geometry section appended (217 → 387 lines) |
| `packages/web-client/src/features/workspace/pane-tree.test.ts` | modified — 19 tests added (22 → 41) |

One private helper was added: `childRects(split, rect)`, shared by `paneRects` and `dividers` so the
proportional subdivision exists once. `nodeAtPath` resolves a `SplitPath` for validation before
`resizeAtDivider` rebuilds anything, which is what lets an invalid path return the input reference.

## How it satisfies the scope

- § Geometry — root occupies the whole area; a `row` divides horizontally and a `column` vertically
  in proportion to `sizes`; dividers sit on interior boundaries at cumulative offsets, spanning the
  split's own cross-axis extent; N children yield N−1 dividers.
- § Resizing — mirrors the pseudocode: shift from `children[boundaryIndex + 1]` to
  `children[boundaryIndex]`, clamp both neighbours, leave all other siblings untouched, sizes still
  sum to 1. `deltaFraction`'s pixel conversion is documented as the UI's job and is not done here.
- § Restoring a persisted layout (the "renders as absent" paragraph) — `effectiveTree` derives the
  rendered tree without mutating the stored one, which is what lets a pane whose tab has not arrived
  yet disappear from the layout while remaining un-pruned until the hydration settle point.

No deviations.

## Build & test results

```
$ npx vitest run packages/web-client/src/features/workspace/pane-tree.test.ts
✓ packages/web-client/src/features/workspace/pane-tree.test.ts (41 tests) 9ms
Test Files  1 passed (1)
     Tests  41 passed (41)

$ npm run build:web-client
✓ built in 7.72s

$ npm run typecheck            # tsc -b
(clean)

$ npx oxlint packages/web-client/src/features/workspace/
lint-exit:0   (no warnings)

$ npx oxfmt <the two files>
Finished in 90ms on 2 files
```

## Acceptance criteria

- [x] A lone leaf maps to `{ x: 0, y: 0, width: 1, height: 1 }`.
- [x] `row` with `[0.25, 0.75]` yields widths 0.25/0.75 at x 0/0.25 at full height; `column` mirrors
      it on y/height — two cases, exact `toEqual`.
- [x] Nested splits compose multiplicatively — "composes nested splits multiplicatively" plus a
      three-deep case asserting C/D at `{0.5,0.5,0.25,0.5}` / `{0.75,0.5,0.25,0.5}`.
- [x] A split with N children yields exactly N−1 dividers at cumulative offsets with the split's own
      direction — row (2 dividers), column (1), and a nested case asserting `splitPath` `[]` vs `[1]`
      and that the inner divider spans only the column's 0.6 extent.
- [x] `resizeAtDivider` changes only the two adjacent siblings, the rest byte-identical (`toBe` on
      the untouched entries), sum still 1 — plus a nested case leaving the ancestor's sizes at
      `[0.4, 0.6]`.
- [x] An overshooting drag clamps exactly at `MIN_PANE_FRACTION` (`0.5/0.5` + delta `0.6` →
      `0.9/0.1`), not past it and not to 0.
- [x] A neighbour already below the minimum, constructed via four real `splitPane` calls
      (`[0.5, 0.25, 0.125, 0.0625, 0.0625]`), is refused a shrink (returns the input reference) and
      permitted a growth to `0.0875` — "lets a pane born below the minimum grow but never shrink
      further".
- [x] `effectiveTree` drops unoccupied leaves, redistributes proportionally (`0.2/0.7`, `0.5/0.7`),
      and applies the same collapse/splice (`row[A, column[B, row[C, D]]]` → `row[A, C, D]` at
      `[0.5, 0.25, 0.25]`); the stored tree is deep-compared against a `structuredClone`.
- [x] `effectiveTree` with an empty `occupied` set returns a single leaf, not an empty tree.

Plus one guard case beyond the criteria: an unknown path, a path landing on a leaf, an out-of-range
boundary, a zero delta, and `NaN` all return the input reference.

## Follow-ups / TODO(verify)

- None. Still inert — nothing imports the module yet.
- `Divider.rect` is intentionally zero-thickness on the split axis; sprint-049 task-003 gives it the
  few-pixel hit area and the hover affordance, so the model stays free of UI constants.
