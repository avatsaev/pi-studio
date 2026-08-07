# Task 003 — `pane-tree`: parse, validate, and renormalize a persisted tree — Summary

- **Sprint:** sprint-048-workspace-split-panes-model
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented

`parsePaneTree(input: unknown): PaneNode | null` plus the `PANE_LAYOUT_VERSION` constant the
persistence envelope (task-005) will stamp records with.

The parser walks the untrusted value recursively, carrying a `seenIds` set so a repeated pane id
anywhere in the tree fails the whole parse. It never throws on any input.

**Repaired** (the layout survives):

- every split's `sizes` are divided by their own sum, unconditionally — no epsilon threshold. Float
  drift accumulates across save/load cycles, and `[1, 1]` is a plausible hand-edit; both become
  `[0.5, 0.5]`-style normalized runs. Nested splits renormalize against their own sum, independent of
  the parent's slot.

**Rejected** (`null`, so the workspace falls back to a single pane):

- non-object input, or a `kind` that is neither `"leaf"` nor `"split"`;
- a bad `direction`, a non-array `children`/`sizes`, `children.length < 2`, or a length mismatch;
- any size that is non-numeric, non-finite, zero, or negative;
- a leaf whose `id` is missing, non-string, or blank (`"   "` included);
- a duplicated pane id anywhere in the tree;
- any child that fails to parse — damage propagates up, so a partially valid tree is still discarded.

Unconditional renormalization is what makes "every split's sizes sum to 1" true by construction for
every tree that enters the store, which is why nothing downstream has to defend against it.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/pane-tree.ts` | modified — parse section appended (387 → 446 lines) |
| `packages/web-client/src/features/workspace/pane-tree.test.ts` | modified — 14 tests added (41 → 55) |

## How it satisfies the scope

- § Pane tree — enforces the documented node constraints (`children.length ≥ 2`, `sizes` parallel and
  each `> 0`, ids unique within a tree).
- § Data & Persistence — "on load, `sizes` are renormalized to sum to 1 … only structural damage
  discards an entry".
- § Error Handling & Edge Cases, the three `Persisted …` rows — malformed tree discards *that*
  workspace's entry (this function returns `null` for one workspace's tree; the whole-record
  `version` discard is task-005's envelope, which is why `PANE_LAYOUT_VERSION` lives here as the
  shared constant).

## Build & test results

```
$ npx vitest run packages/web-client/src/features/workspace/pane-tree.test.ts
✓ packages/web-client/src/features/workspace/pane-tree.test.ts (55 tests) 10ms
Test Files  1 passed (1)
     Tests  55 passed (55)

$ npm run build:web-client
✓ built in 7.70s

$ npm run typecheck            # tsc -b
(clean)

$ npx oxlint packages/web-client/src/features/workspace/
lint-exit:0   (no warnings)

$ npx oxfmt <the two files>
Finished in 92ms on 2 files
```

## Acceptance criteria

- [x] A valid leaf and a valid nested split round-trip to structurally equal trees — the nested case
      goes through `JSON.parse(JSON.stringify(...))` so it is genuinely untrusted-shaped input.
- [x] `[0.3333, 0.3333, 0.3333]` renormalizes to sum 1 with proportions preserved (each `1/3`, the
      first two equal to 15 digits).
- [x] `[1, 1]` renormalizes to exactly `[0.5, 0.5]` rather than being rejected.
- [x] `sizes.length !== children.length` returns `null` (both too-long and too-short).
- [x] A split with one child — and with zero children — returns `null`.
- [x] `NaN`, `Infinity`, `0`, `-0.5`, `"0.5"`, and `null` sizes all return `null`.
- [x] A duplicated pane id returns `null`, both as immediate siblings and across nesting levels.
- [x] A leaf with a missing, non-string, empty, or whitespace-only `id` returns `null`.
- [x] Damage nested three levels deep discards the whole tree.
- [x] `null`, `undefined`, a string, a number, a boolean, `{}`, `[]`, and `[leaf]` all return `null`
      without throwing.
- [x] A parsed tree passes `leafIds`, `paneRects`, and `dividers` — asserted on
      `[1, 1, 2]` → `C` at `{ x: 0.5, width: 0.5 }` with 2 dividers.

Plus a version-constant case and a nested-renormalization case beyond the listed criteria.

## Follow-ups / TODO(verify)

- **Wording note, not a gap:** the criterion says sizes renormalize to "exactly 1". Division by the
  sum is exact for representable cases like `[1, 1]` (asserted with `toEqual([0.5, 0.5])`), but
  `[0.3333 × 3]` lands within ~1e-16 of 1, not bit-exactly — hence `toBeCloseTo(1, 12)` there. This
  matches the module's existing 1e-9 tolerance convention and is what "divide by the sum" can
  guarantee in IEEE-754.
- Still inert — nothing imports the module yet. Task-005 consumes `PANE_LAYOUT_VERSION` and
  `parsePaneTree` for the record envelope.
