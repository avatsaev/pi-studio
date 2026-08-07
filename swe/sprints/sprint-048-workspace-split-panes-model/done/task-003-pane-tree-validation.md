# Task 003 — `pane-tree`: parse, validate, and renormalize a persisted tree

- **Sprint:** sprint-048-workspace-split-panes-model
- **Status:** done
- **Type:** feature
- **Area:** web-client / workspace
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-001

## Goal
Turn untrusted persisted JSON into a valid `PaneNode`, or `null` — renormalizing harmless float
drift while rejecting genuine structural damage.

## Context / why
The layout record is client-local JSON that survives across versions and hand-editing, so every
load is untrusted input. The spec draws a deliberate line: sizes that merely drift from summing to 1
are **renormalized** (float error accumulates across save/load cycles and is expected), whereas
structural damage — child/size length mismatch, duplicate pane ids, non-finite or non-positive
sizes, a split with fewer than two children — **discards that workspace's entry** so it falls back
to a single pane without touching other workspaces.

Getting this wrong in either direction is bad: too strict and users lose their layout to rounding,
too lax and a malformed tree crashes geometry or renders a pane twice.

## Scope references
- `clean-room-scope/features/workspace-split-panes.md` § Pane tree, § Data & Persistence,
  § Error Handling & Edge Cases (the three `Persisted …` rows)
- Modify: `packages/web-client/src/features/workspace/pane-tree.ts`
- Modify: `packages/web-client/src/features/workspace/pane-tree.test.ts`

## What to build
Extend `pane-tree.ts`:

```ts
/** Bumped only on a breaking layout-record shape change; a mismatch discards the whole record. */
export const PANE_LAYOUT_VERSION = 1;

/** Parse untrusted JSON into a valid tree, or null when structurally damaged. */
export function parsePaneTree(input: unknown): PaneNode | null;
```

Accept and normalize:
- A leaf `{ kind: "leaf", id }` with a non-empty string `id`.
- A split whose `children` has ≥ 2 entries and `sizes` the same length, every size finite and `> 0`.
- Renormalize each split's `sizes` to sum to exactly 1 (divide by the sum) — no epsilon threshold
  needed, just always renormalize; a sum of 0 is impossible given "every size > 0".

Reject (return `null`) when:
- `input` is not an object, or `kind` is neither `"leaf"` nor `"split"`.
- `children.length < 2`, or `sizes.length !== children.length`.
- Any size is non-finite (`NaN`/`Infinity`) or `<= 0`.
- Any pane id repeats anywhere in the tree, or any leaf id is missing/blank.
- Any child fails to parse (damage propagates up — a partially valid tree is still discarded).

## Out of scope
- Reading/writing `localStorage` and the record envelope around the tree (task-005).
- Pending claims and pruning (task-006).

## Acceptance criteria
- [ ] A valid leaf and a valid nested split round-trip to structurally equal trees.
- [ ] Sizes `[0.3333, 0.3333, 0.3333]` are renormalized to sum to exactly 1 while preserving their
      relative proportions.
- [ ] Sizes `[1, 1]` (a plausible hand-edit) renormalize to `[0.5, 0.5]` rather than being rejected.
- [ ] `sizes.length !== children.length` returns `null`.
- [ ] A split with one child returns `null`.
- [ ] A `NaN`, `Infinity`, `0`, or negative size returns `null`.
- [ ] A duplicated pane id anywhere in the tree returns `null`.
- [ ] A leaf with a missing, non-string, or empty `id` returns `null`.
- [ ] Damage nested three levels deep still returns `null` for the whole tree.
- [ ] `null`, `undefined`, a string, a number, and `{}` all return `null` without throwing.
- [ ] A parsed tree passes `paneRects`/`leafIds` from tasks 001–002 without throwing.

## Test / verification plan
- Tests: extend `pane-tree.test.ts` with a `parsePaneTree` describe block — one case per acceptance
  criterion. Run `npx vitest run packages/web-client/src/features/workspace/pane-tree.test.ts`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.

## Notes
- Parse must never throw on any input — callers treat `null` as "start from a single pane".
- Renormalizing unconditionally is simpler and strictly safer than comparing against an epsilon, and
  it makes the "sizes sum to 1" invariant true by construction for every tree that enters the store.
