# Task 001 — `pane-tree`: node model, `canSplit`, `splitPane`, `removePane` — Summary

- **Sprint:** sprint-048-workspace-split-panes-model
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented

A pure, framework-free pane-tree module: the leaf/split node model, depth measurement, the
split-legality predicate, the split rewrite, and the remove/collapse rewrite. No React, no store, no
persistence — every function is total, pure, and returns a new tree.

Public surface (`packages/web-client/src/features/workspace/pane-tree.ts`):

| Export | Contract |
|---|---|
| `LeafPane`, `SplitNode`, `PaneNode`, `SplitDirection`, `SplitRegion` | Node model; `sizes` parallel to `children`, each > 0, summing to 1 |
| `MAX_PANE_DEPTH = 4` | Deepest tree a split may produce |
| `leafIds(tree)` | Leaf ids in document order |
| `paneDepth(tree, id, depth = 1)` | 1-based depth; `null` when absent |
| `directionOfRegion(region)` | `left`/`right` → `row`, `top`/`bottom` → `column` |
| `canSplit(tree, id, region)` | Per-branch legality (see below) |
| `splitPane(tree, id, region, newId)` | Split, or the tree unchanged when refused |
| `removePane(tree, id)` | Remove + redistribute + collapse; never removes the last leaf |
| `normalizePaneTree(node)` | Bottom-up single-child collapse + same-direction splice |

Two behaviours the task exists to protect:

1. **Per-branch depth check.** `canSplit` resolves the same-direction-parent case *first* and returns
   `true` unconditionally there (a sibling insert cannot deepen the tree); only the nesting branch
   evaluates `depth + 1 <= MAX_PANE_DEPTH`. At depth 4 a split along the run's own direction still
   succeeds while the perpendicular one is refused.
2. **Flat-run collapse.** `removePane` drops the leaf, rescales survivors to fill the vacated slot,
   then runs `normalizePaneTree`, which recurses bottom-up: a split left with one child is replaced
   by that child, and any child that is a same-direction split has its children spliced into the
   parent with sizes scaled by the inherited slot. `row[A, column[B, row[C, D]]]` minus `B` yields
   `row[A, C, D]` at `[0.5, 0.25, 0.25]`, not a nested row.

One addition beyond the task's literal signature list: `splitPane` also refuses when `newPaneId`
already exists in the tree, and `removePane`/`splitPane` refuse unknown ids. Both are cheap
backstops for the spec's "id unique within a workspace's tree" invariant, in the same
return-unchanged style as the documented refusal.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/pane-tree.ts` | created (217 lines) |
| `packages/web-client/src/features/workspace/pane-tree.test.ts` | created — 22 tests |

## How it satisfies the scope

- § Pane tree — node shapes, constraints, `MAX_PANE_DEPTH = 4` with a lone leaf at depth 1.
- § Splitting — `canSplit`/`splitPane` mirror the spec pseudocode including the "evaluated per
  branch, after resolving whether the split reuses a same-direction parent" requirement and the
  `[new, target]` / `[target, new]` child ordering.
- § Removing a pane / collapsing — proportional redistribution, upward collapse, and the splice step
  that preserves the flat-run property.
- `splitPane`'s refusal returns the input reference (structurally equal), matching "refuse — no
  layout change at all"; the gesture layer's degrade-to-`center` behaviour is sprint-049 task-004
  and is deliberately not implemented here.

No deviations from the task's stated contract.

## Build & test results

```
$ npx vitest run packages/web-client/src/features/workspace/pane-tree.test.ts
✓ packages/web-client/src/features/workspace/pane-tree.test.ts (22 tests) 6ms
Test Files  1 passed (1)
     Tests  22 passed (22)

$ npm run build:web-client
✓ built in 8.13s

$ npm run typecheck            # tsc -b
(clean)

$ npx oxlint packages/web-client/src/features/workspace/
(no warnings)

$ npx oxfmt <the two new files>
Finished in 101ms on 2 files
```

## Acceptance criteria

- [x] `paneDepth` returns 1 for a lone leaf, 4 for a leaf under three splits, `null` for an unknown
      id — `describe("paneDepth")`, 3 cases.
- [x] At depth 4 `canSplit` is `true` for the parent-matching direction and `false` for the
      perpendicular one — "allows a same-direction sibling insert at maximum depth…".
- [x] Same-direction split grows `children` by one, leaves depth unchanged, halves the target's
      size, leaves other siblings byte-identical (`sizes` asserted with `toEqual`, not `toBeCloseTo`)
      — "inserts a sibling into a same-direction parent…".
- [x] Perpendicular split yields a `[0.5, 0.5]` split with `left`/`top` first and `right`/`bottom`
      second — "replaces the leaf with a half/half split…".
- [x] Refused splits return a structurally equal tree (depth cap, unknown target, duplicate id) —
      "returns a structurally equal tree when the split is refused".
- [x] `removePane` on the only leaf returns the tree unchanged.
- [x] Every split's `sizes` stays parallel to `children` and sums to 1 within 1e-9 after any
      removal — `assertWellFormedSizes` asserted in 6 cases plus a 6-split/N-remove interleaving.
- [x] A split left with one child is replaced by that child, inheriting its slot and size —
      "replaces a split left with one child…" (`sizes` stay `[0.4, 0.6]`).
- [x] `removePane(row[A, column[B, row[C, D]]], "B")` yields `row[A, C, D]` at `[0.5, 0.25, 0.25]` —
      "splices a promoted same-direction split flat instead of nesting it".
- [x] No function mutates its input — `describe("purity")` deep-compares against a
      `structuredClone` after eight calls.

## Follow-ups / TODO(verify)

- None. The module is inert: nothing imports it yet, so this task cannot regress the workspace UI.
- `normalizePaneTree` is exported (not in the task's signature list) because task-002's
  `effectiveTree` and task-003's `parsePaneTree` both need the same collapse semantics; it is the
  natural seam rather than duplicated logic.
