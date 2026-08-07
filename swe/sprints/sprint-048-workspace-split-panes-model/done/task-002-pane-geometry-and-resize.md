# Task 002 — `pane-tree`: rectangles, dividers, resize, effective tree

- **Sprint:** sprint-048-workspace-split-panes-model
- **Status:** done
- **Type:** feature
- **Area:** web-client / workspace
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Derive pane rectangles and divider positions from the tree, and implement divider resizing with a
minimum-size clamp — all pure arithmetic.

## Context / why
The rendering strategy the continuity invariant forces (a flat host that positions every panel at
its pane's computed rectangle — never re-parenting panels into pane nodes) needs geometry as data,
not as CSS nesting. Rectangles must therefore be computable from the tree alone.

Two details matter:

- **`MIN_PANE_FRACTION` is a resize-only constraint.** `splitPane` halves a target unconditionally,
  so a pane can legitimately be *born* below the minimum after repeated splits. The clamp only
  guarantees a divider drag never *reduces* a neighbour below it; an already-sub-minimum neighbour
  can still be grown.
- **Unclaimed panes render as absent.** During restore a persisted pane may hold no tab yet, and
  geometry must treat it exactly as if `removePane` had run — *without* mutating the stored tree.
  That is a pure derivation and belongs here.

## Scope references
- `clean-room-scope/features/workspace-split-panes.md` § Geometry, § Resizing,
  § Restoring a persisted layout (the "renders as absent" paragraph)
- Modify: `packages/web-client/src/features/workspace/pane-tree.ts`
- Modify: `packages/web-client/src/features/workspace/pane-tree.test.ts`

## What to build
Extend `pane-tree.ts`:

```ts
export const MIN_PANE_FRACTION = 0.1;

export interface Rect { x: number; y: number; width: number; height: number }
/** Fractional rects (0..1) keyed by pane id. Callers scale by the content box. */
export function paneRects(tree: PaneNode): Map<string, Rect>;

/** Path of child indices from the root to the split that owns the boundary. */
export type SplitPath = readonly number[];
export interface Divider {
  splitPath: SplitPath;
  boundaryIndex: number;          // 0 .. children.length - 2
  direction: "row" | "column";
  rect: Rect;                     // zero-thickness line; the UI gives it hit-area width
}
export function dividers(tree: PaneNode): Divider[];

export function resizeAtDivider(
  tree: PaneNode, splitPath: SplitPath, boundaryIndex: number, deltaFraction: number,
): PaneNode;

/** Tree as rendered: leaves not in `occupied` are dropped and collapsed, stored tree untouched. */
export function effectiveTree(tree: PaneNode, occupied: ReadonlySet<string>): PaneNode;
```

- `paneRects` — root occupies `{0,0,1,1}`; a `row` split divides its own rect horizontally in
  proportion to `sizes`, a `column` vertically; recurse.
- `dividers` — a split with N children yields N−1 dividers, each at the cumulative-size offset,
  spanning the split's own cross-axis extent.
- `resizeAtDivider` — shift `deltaFraction` from `children[boundaryIndex + 1]` to
  `children[boundaryIndex]`, clamped so **neither** neighbour ends below `MIN_PANE_FRACTION`; all
  other siblings untouched; sizes still sum to 1.
- `effectiveTree` — repeatedly apply `removePane` for every leaf not in `occupied` (reusing
  task-001's collapse, so the flat-run splice applies here too). Returns the tree unchanged when all
  leaves are occupied; when *no* leaf is occupied, returns the single-leaf terminal state rather than
  an empty tree.

## Out of scope
- Persistence, validation, stores, React, pointer handling (later tasks).
- Pixel conversion and `ResizeObserver` wiring (sprint-049 task-002).

## Acceptance criteria
- [ ] A lone leaf maps to `{ x: 0, y: 0, width: 1, height: 1 }`.
- [ ] `row` with sizes `[0.25, 0.75]` yields rects of width 0.25 and 0.75 at x 0 and 0.25, both full
      height; `column` mirrors this on y/height.
- [ ] Nested splits compose multiplicatively (a child of a 0.5-wide row slot spans 0.5 of the total).
- [ ] A split with N children yields exactly N−1 dividers, positioned at cumulative offsets with the
      split's own direction.
- [ ] `resizeAtDivider` changes only the two adjacent siblings; the rest are byte-identical and the
      sum stays 1 (within 1e-9).
- [ ] A drag large enough to push a neighbour under `MIN_PANE_FRACTION` clamps exactly at the
      minimum instead of overshooting or collapsing to 0.
- [ ] A neighbour already below `MIN_PANE_FRACTION` (constructed via repeated `splitPane`) can be
      grown by a drag but never shrunk further.
- [ ] `effectiveTree` drops unoccupied leaves, redistributes proportionally, and applies the same
      collapse/splice rules as `removePane`; the input tree is not mutated.
- [ ] `effectiveTree` with an empty `occupied` set returns a single leaf, not an empty tree.

## Test / verification plan
- Tests: extend `pane-tree.test.ts` — one case per acceptance criterion. Run
  `npx vitest run packages/web-client/src/features/workspace/pane-tree.test.ts`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.

## Notes
- Keep rects fractional. Converting to pixels in the module would force geometry to re-derive on
  every container resize; the host multiplies by its measured box instead.
- `deltaFraction` at the call site is the pointer delta along the split axis divided by the content
  box extent on that axis — document it, but the conversion itself is the UI's job.
