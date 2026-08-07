# Task 004 — `layout-store`: pane assignment, focus, and split operations

- **Sprint:** sprint-048-workspace-split-panes-model
- **Status:** done
- **Type:** feature
- **Area:** web-client / stores
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal
A zustand store owning, per workspace: the pane tree, tab→pane assignment, per-pane active tabs,
and the focused pane — with every mutation the UI will need. Built inert: nothing renders from it
yet.

## Context / why
The spec's ownership rule: *an implementation MUST pick one owner so the invariant (every tab in
exactly one pane) cannot be violated, and MUST NOT maintain both directions as independent mutable
state.* The division of labour chosen here, which sprint-049 task-001 wires up:

- **`tab-store` stays the single owner of tab identity and global tab order.** Per-pane tab order is
  *derived*: the tab-store order filtered by pane membership. Reorder-within-a-pane therefore stays
  `tab-store.reorder` — no second order to drift.
- **`layout-store` owns pane structure**: the tree, `placement` (tab id → pane id), `activeByPane`,
  and `focusedPaneId` — all keyed by normalized workspace cwd.
- **The workspace-active tab is derived** (`activeByPane[focusedPaneId]`), never stored — a stored
  duplicate can drift and point at an invisible tab.

## Scope references
- `clean-room-scope/features/workspace-split-panes.md` § Tab ↔ pane assignment, § Splitting,
  § Programmatic splits, § Moving a tab between panes, § Removing a pane / collapsing
- `packages/web-client/src/features/workspace/pane-tree.ts` (tasks 001–002)
- `packages/web-client/src/stores/tab-store.ts` — read for the id/order contract; not modified here
- Create: `packages/web-client/src/stores/layout-store.ts`
- Create: `packages/web-client/src/stores/layout-store.test.ts`

## What to build
Create `packages/web-client/src/stores/layout-store.ts`:

```ts
export interface WorkspacePaneLayout {
  tree: PaneNode;
  placement: Record<string, string>;     // tab id -> pane id
  activeByPane: Record<string, string>;  // pane id -> tab id
  focusedPaneId: string;
}

interface LayoutStoreState {
  layouts: Record<string, WorkspacePaneLayout>;  // keyed by normalized workspace cwd

  /** Create the single-leaf default on first touch; idempotent. */
  ensureWorkspace(cwd: string): void;
  /** Place a tab: explicit pane if given & present, else the focused pane, else the first leaf.
   *  Makes it that pane's active tab and focuses the pane unless `background` is true. */
  assignTab(cwd: string, tabId: string, paneId?: string, background?: boolean): void;
  /** Spec `moveTab`: reassign, activate in target, focus target; source pane's active falls back
   *  to the nearest remaining sibling by index; an emptied source pane is removed. */
  moveTab(cwd: string, tabId: string, targetPaneId: string): void;
  /** splitPane + moveTab of an existing tab. No-op when the tab is the target pane's only tab,
   *  or when canSplit is false (callers degrade/disable; this is the backstop). */
  splitWithTab(cwd: string, tabId: string, targetPaneId: string, region: SplitRegion): void;
  /** splitPane only; returns the new pane id (focused, empty) or null when refused. The caller
   *  opens a tab into it immediately — Programmatic splits § split-empty. */
  splitEmpty(cwd: string, targetPaneId: string, region: SplitRegion): string | null;
  /** Remove a closed tab; an emptied pane collapses (never the last one). */
  removeTab(cwd: string, tabId: string): void;
  setActiveTab(cwd: string, paneId: string, tabId: string): void;
  focusPane(cwd: string, paneId: string): void;
  resizeDivider(cwd: string, splitPath: SplitPath, boundaryIndex: number, delta: number): void;

  paneOfTab(cwd: string, tabId: string): string | null;
  /** Derived workspace-active tab: activeByPane[focusedPaneId] ?? null. */
  activeTabOf(cwd: string): string | null;
}
export const useLayoutStore = create<LayoutStoreState>()(...);
```

Behavioural details:

- Pane ids: mint with a module-local counter or `crypto.randomUUID()` — unique within a workspace
  tree (the task-001 invariant); never derived from tab ids.
- `moveTab` into the pane the tab is already in is a no-op (cross-pane reorder is the tab-store's
  job).
- `removeTab` on a pane's active tab picks the nearest remaining tab of that pane **by index in the
  pane's derived order** (pass the ordered sibling list in, or accept a `nextActive` hint —
  document the choice); the last tab of the last pane leaves `activeByPane` empty but keeps the
  single-leaf tree.
- When `removePane` collapses the focused pane away, focus moves to a surviving pane (nearest by
  tree position; first leaf is acceptable).
- Every mutation must keep the three invariants: each placed tab in exactly one pane; each
  `activeByPane` entry names a tab placed in that pane; `focusedPaneId` names a leaf in the tree.
  Violations are impossible by construction, not repaired after the fact.

## Out of scope
- Persistence to localStorage and identity mapping (task-005).
- Pending restore claims, hydration settle point, pruning (task-006).
- Touching `tab-store.ts`, `TabPanelHost`, `TabStrip`, or any component (sprint-049).

## Acceptance criteria
- [ ] `ensureWorkspace` creates a single-leaf layout with that leaf focused; calling it again is a
      no-op.
- [ ] `assignTab` with no pane id lands in the focused pane and becomes its active tab;
      `background: true` places without changing active or focus.
- [ ] `splitWithTab` on a pane with ≥ 2 tabs creates the new pane on the dropped side with the moved
      tab active in it and the new pane focused; the source pane's active falls back to its nearest
      remaining sibling.
- [ ] `splitWithTab` where the tab is the target pane's only tab changes nothing (structurally equal
      state).
- [ ] `splitWithTab`/`splitEmpty` when `canSplit` is false change nothing / return `null`.
- [ ] `splitEmpty` returns a focused empty pane id; a subsequent `assignTab(tabId, newPaneId)`
      activates the tab there.
- [ ] `moveTab` to another pane activates it there, focuses the target, and collapses an emptied
      source pane — with the source's space redistributed proportionally (assert via `paneRects`).
- [ ] `removeTab` of a pane's last tab removes the pane and moves focus to a survivor; `removeTab`
      of the last tab of the *only* pane keeps the single-leaf tree with empty `activeByPane`.
- [ ] `resizeDivider` delegates to `resizeAtDivider` and leaves non-adjacent siblings untouched.
- [ ] After any interleaving of the above (a randomized/property-style test is acceptable): every
      placed tab maps to exactly one leaf present in the tree, every `activeByPane` value is placed
      in its pane, and `focusedPaneId` is a leaf in the tree.

## Test / verification plan
- Tests: create `packages/web-client/src/stores/layout-store.test.ts` — one case per acceptance
  criterion; drive the store via `useLayoutStore.getState()` exactly as `explorer-store.test.ts`
  does. Run `npx vitest run packages/web-client/src/stores/layout-store.test.ts`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.

## Notes
- Inert on its own: nothing subscribes to this store until sprint-049 task-001, so it cannot regress
  the workspace UI.
- Do NOT store per-pane tab order here — that is the drift the spec forbids. Derived order =
  tab-store order filtered by `placement`.
