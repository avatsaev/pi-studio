# Task 001 — `pane-tree`: node model, `canSplit`, `splitPane`, `removePane`

- **Sprint:** sprint-048-workspace-split-panes-model
- **Status:** done
- **Type:** feature
- **Area:** web-client / workspace
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
A pure, framework-free pane-tree module holding the split/collapse algebra, with no React, no store,
and no persistence — the foundation every later task builds on.

## Context / why
Split panes are geometry plus a tree rewrite. Both are pure functions, so they belong in a module
that can be exhaustively unit-tested without a DOM. Two subtleties from the spec carry real bug
risk and are the reason this task exists on its own:

1. **Depth is checked per branch.** Inserting a sibling into an existing same-direction run never
   deepens the tree, so at maximum depth a split *along the run's direction* is still legal; only a
   perpendicular (nesting) split is refused. A naive `depth + 1 > MAX` check rejects both.
2. **Collapse must keep runs flat.** When a split is left with one child and that child is itself a
   split with the same direction as its new parent, its children must be spliced into the parent —
   otherwise removing a pane silently produces same-direction nesting, wasting depth against the cap
   and changing divider behaviour.

## Scope references
- `clean-room-scope/features/workspace-split-panes.md` § Pane tree, § Splitting,
  § Removing a pane / collapsing
- `clean-room-scope/features/workspace-ui.md` § Pane / split model
- Create: `packages/web-client/src/features/workspace/pane-tree.ts`
- Create: `packages/web-client/src/features/workspace/pane-tree.test.ts`

## What to build
Create `packages/web-client/src/features/workspace/pane-tree.ts`. Pure module: no imports from
`react`, `zustand`, or any store.

```ts
export interface LeafPane { kind: "leaf"; id: string }
export interface SplitNode {
  kind: "split";
  direction: "row" | "column";
  children: PaneNode[];   // length >= 2
  sizes: number[];        // parallel to children, each > 0, sums to 1
}
export type PaneNode = LeafPane | SplitNode;
export type SplitRegion = "left" | "right" | "top" | "bottom";

export const MAX_PANE_DEPTH = 4;

export function leafIds(tree: PaneNode): string[];
/** 1-based: a lone leaf is depth 1. `null` when the pane is not in the tree. */
export function paneDepth(tree: PaneNode, paneId: string): number | null;
export function canSplit(tree: PaneNode, targetPaneId: string, region: SplitRegion): boolean;
/** Returns the tree UNCHANGED when `canSplit` is false (refusal is a backstop, not an error). */
export function splitPane(
  tree: PaneNode, targetPaneId: string, region: SplitRegion, newPaneId: string,
): PaneNode;
export function removePane(tree: PaneNode, paneId: string): PaneNode;
```

Behaviour to satisfy (see spec pseudocode for the full contract):

- `canSplit` — resolve `direction` from the region, then: if the target's parent is a split with the
  **same** direction → `true` (sibling insert, depth unchanged); else
  `paneDepth(target) + 1 <= MAX_PANE_DEPTH`.
- `splitPane` — same-direction parent → insert the new leaf as a sibling immediately before/after
  the target, giving it half the target's size and leaving every other sibling untouched. Otherwise
  replace the target leaf **in place** with a split node, children ordered `[new, target]` for
  `left`/`top` and `[target, new]` for `right`/`bottom`, sizes `[0.5, 0.5]`.
- `removePane` — never removes the last leaf. Drop the leaf, redistribute its size
  **proportionally** across remaining siblings, then collapse upward: a split left with one child is
  replaced by that child, which inherits the parent's slot and size; if that child is a split with
  the same direction as its new parent, splice its children into the parent at that slot, scaling
  each spliced size by the inherited slot size. Repeat while it applies.

All functions are pure — never mutate their input.

## Out of scope
- Rectangles, dividers, resizing (task-002).
- Validation/normalization of persisted trees (task-003).
- Any store, persistence, or React (task-004 onward).

## Acceptance criteria
- [ ] `paneDepth` returns 1 for a lone leaf and 4 for a leaf nested under three splits; `null` for an
      unknown pane id.
- [ ] At depth 4, `canSplit` is `true` for a region whose direction matches the target's parent split
      and `false` for the perpendicular region.
- [ ] `splitPane` into a same-direction parent grows that split's `children` by one, leaves tree
      depth unchanged, gives the new pane half the target's former size, and leaves other siblings'
      sizes byte-identical.
- [ ] `splitPane` with a perpendicular region replaces the leaf with a `[0.5, 0.5]` split; `left`/`top`
      put the new pane first, `right`/`bottom` put it second.
- [ ] `splitPane` returns a structurally equal tree when `canSplit` is false.
- [ ] `removePane` on the only leaf returns the tree unchanged.
- [ ] After any `removePane`, every split's `sizes` still sums to 1 (within 1e-9) and stays parallel
      to `children`.
- [ ] A split left with one child is replaced by that child, inheriting its slot and size.
- [ ] `removePane(row[A, column[B, row[C, D]]], "B")` yields `row[A, C, D]` — no same-direction
      nesting — with `C`/`D` sizes scaled into the slot the `column` occupied.
- [ ] No function mutates its input tree (assert the input is deep-equal to a pre-call clone).

## Test / verification plan
- Tests: create `packages/web-client/src/features/workspace/pane-tree.test.ts` — one case per
  acceptance criterion, including the flat-run splice case and the depth-4 same-direction case.
  Run `npx vitest run packages/web-client/src/features/workspace/pane-tree.test.ts`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Format: `npx oxfmt` on the two new files only.

## Notes
- This task is inert: nothing imports the module yet, so it cannot regress the workspace.
- `MAX_PANE_DEPTH = 4` matches `workspace-ui.md`. Keep it exported so tests assert against the
  constant rather than a literal.
