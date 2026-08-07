# Task 004 — `layout-store`: pane assignment, focus, and split operations — Summary

- **Sprint:** sprint-048-workspace-split-panes-model
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented

`packages/web-client/src/stores/layout-store.ts` — a zustand store owning pane structure per
workspace, with every mutation the UI will need. Inert: nothing subscribes to it until sprint-049
task-001.

```ts
interface WorkspacePaneLayout {
  tree: PaneNode;
  placement: Record<string, string>;     // tab id -> pane id
  activeByPane: Record<string, string>;  // pane id -> tab id
  focusedPaneId: string;                 // always a leaf in `tree`
}
```

Actions: `ensureWorkspace`, `assignTab`, `moveTab`, `splitWithTab`, `splitEmpty`, `removeTab`,
`setActiveTab`, `focusPane`, `resizeDivider`; selectors `paneOfTab`, `activeTabOf`.

**Ownership split (the point of the task).** `tab-store` keeps tab identity and *global* order;
this store keeps pane structure. Per-pane order is derived (global order filtered by `placement`),
so reorder-within-a-pane stays `tab-store.reorder` and no second order exists to drift. The
workspace-active tab is derived — `activeTabOf` = `activeByPane[focusedPaneId]` — never stored.

**Invariants by construction, not repair.** Three shared private helpers carry that weight:

- `placeTab` is the single write path for both `assignTab` and `moveTab`. It reassigns `placement`,
  optionally activates, falls the *source* pane's active tab back to its nearest remaining sibling,
  and removes the source pane when it went empty. Because there is one path, "every `activeByPane`
  value is placed in its own pane" cannot be violated by a new caller.
- `withPaneRemoved` is only ever called for a pane with no tabs, so no `placement` entry can be left
  pointing at a vanished pane. It drops the pane's `activeByPane` entry and moves focus to a survivor
  when the focused pane was the one removed.
- `nearestSibling` mirrors `tab-store.close`'s existing `Math.min(idx, remaining.length - 1)` rule, so
  fallback behaviour is identical to what users already get today.

**Decision recorded (the task left it open):** the fallback-active-tab operations take an optional
trailing `order?: readonly string[]` — the workspace's tab ids in global order. Sprint-049's
`tab-store` wiring passes it so the fallback matches the visible strip; omitted, the store uses
`placement` insertion order, which is deterministic but not necessarily the user-visible order. This
was chosen over storing per-pane order (the drift the spec forbids) and over a `nextActive` hint
(which would push the same filtering logic into every caller).

Two behaviours worth flagging because later tasks depend on them:

- `setActiveTab` deliberately does **not** focus the pane. Restore (task-006) must set a non-focused
  pane's active tab without stealing focus, and sprint-049 calls `focusPane` + `setActiveTab` together
  for a real user click.
- Any operation on an unknown cwd materializes that workspace's default layout, so callers never have
  to sequence `ensureWorkspace` first.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/stores/layout-store.ts` | created (321 lines) |
| `packages/web-client/src/stores/layout-store.test.ts` | created — 29 tests |

Pane ids are minted as `pane-${crypto.randomUUID()}` (the convention already used in
`Composer.tsx`), never derived from a tab id — a pane outlives the tabs that pass through it, and a
session-local counter could collide with pane ids loaded from persistence.

## How it satisfies the scope

- § Tab ↔ pane assignment — one owner for the invariant; focused pane's active tab derived as the
  workspace-active tab.
- § Moving a tab between panes — `moveTab` implements the pseudocode exactly: reassign, activate in
  target, focus target, source falls back by index, empty source removed.
- § Splitting / § Programmatic splits — `splitWithTab` is "create the new pane, then move the dragged
  tab into it" with the only-tab no-op rule; `splitEmpty` is the split-empty primitive the Split
  right / Split down affordances need, returning the pane id so the caller can seed a tab into it.
- § Removing a pane / collapsing — `removeTab` collapses an emptied pane except the last one, which
  is kept to render the workspace empty state.

No deviations.

## Build & test results

```
$ npx vitest run packages/web-client/src/stores/layout-store.test.ts
✓ packages/web-client/src/stores/layout-store.test.ts (29 tests) 31ms
Test Files  1 passed (1)
     Tests  29 passed (29)

$ npm run build:web-client
✓ built in 7.86s

$ npm run typecheck            # tsc -b
(clean)

$ npx oxlint packages/web-client/src/stores/layout-store.ts …test.ts
exit:0   (no warnings; the pre-existing session-store warning is untouched)

$ npx oxfmt <the two new files>
Finished in 100ms on 2 files
```

## Acceptance criteria

- [x] `ensureWorkspace` creates a single-leaf layout with that leaf focused; a second call returns the
      same object reference (`toBe`).
- [x] `assignTab` with no pane id lands in the focused pane and becomes its active tab;
      `background: true` places without touching active or focus (asserted on a two-pane layout, and
      `activeTabOf` still reports the focused pane's tab).
- [x] `splitWithTab` on a pane with 2 tabs creates the new pane on the dropped side (`childIds()`
      order asserted for all four regions), the moved tab active in it, the new pane focused, and the
      source falling back to `t1`.
- [x] `splitWithTab` where the tab is the target pane's only tab returns the identical state object.
- [x] `splitWithTab` / `splitEmpty` at the depth cap change nothing / return `null` — and the same
      pane still splits along its parent run's direction, proving the per-branch depth check reaches
      the store.
- [x] `splitEmpty` returns a focused empty pane id; a subsequent `assignTab(t2, created)` activates
      `t2` there and makes it the workspace-active tab.
- [x] `moveTab` activates in the target, focuses it, collapses the emptied source, and redistributes
      its space proportionally — asserted through `paneRects` (`0.5 : 0.25` → `2/3 : 1/3`).
- [x] `removeTab` of a pane's last tab removes the pane and moves focus to the survivor; of the last
      tab of the only pane keeps `{ kind: "leaf" }` with empty `placement`/`activeByPane` and
      `activeTabOf` `null`.
- [x] `resizeDivider` delegates to `resizeAtDivider`, leaving `sizes[0]` byte-identical, and no-ops on
      a fully clamped or out-of-range drag.
- [x] Invariants hold across interleaving — a seeded 400-step sequence over 7 operation kinds asserts
      after **every** step that pane ids are unique, `focusedPaneId` is a leaf, every `placement`
      value is a live leaf, and every `activeByPane` entry names a tab placed in that pane.

Plus workspace independence, first-touch materialization, dead-pane fallbacks, and
`setActiveTab`-without-focus cases beyond the listed criteria.

## Follow-ups / TODO(verify)

- None blocking. Task-005 adds identity-keyed persistence on top; task-006 adds pending claims,
  the hydration settle point, and pruning, and will need `createPaneLayout` (exported for that
  reason).
