# Task 001 — Route `tab-store` open/close/activate through the layout store

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done
- **Type:** refactor
- **Area:** web-client / stores
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-048/task-006

## Goal
Every tab lifecycle event flows through the layout store, and the workspace-active tab becomes a
derivation of (focused pane, per-pane actives) — while single-pane behaviour stays byte-for-byte
identical to today.

## Context / why
With splits, `tab-store`'s single global `activeTabId` is no longer the whole truth: a terminal can
be *visible* (active in a non-focused pane) without being the workspace-active tab. The continuity
invariant's consequence section calls this out explicitly — visibility must be evaluated per pane.

This is the riskiest task of the feature: it touches the store every panel and strip reads. The
protection is that with exactly one pane, every new code path must reduce to the current behaviour
— the existing `tab-store.test.ts` suite is the regression harness and must keep passing.

## Scope references
- `clean-room-scope/features/workspace-split-panes.md` § Tab ↔ pane assignment,
  § Panel continuity invariant (per-pane visibility consequence)
- Modify: `packages/web-client/src/stores/tab-store.ts` — `open` (104), `close` (119),
  `activate` (148), `switchWorkspace` (163), `closeByPathPrefix` (205)
- Modify: `packages/web-client/src/stores/layout-store.ts` (selectors only, if gaps emerge)
- Modify: `packages/web-client/src/stores/tab-store.test.ts` (additions; existing cases unchanged)

## What to build
- `open(tab)` → after inserting, call `layout-store.claimPaneFor(tab.workspaceCwd, tab.id,
  tabIdentity(tab))`; a re-open of an existing id activates via the layout store (focus its pane,
  make it active there).
- `close(id)` → `layout-store.removeTab`; the sibling-fallback logic (129–137) now asks the layout
  store: next active = the closed tab's pane's next active if the pane survives, else the surviving
  focused pane's active tab. `closeByPathPrefix` inherits this via `close`.
- `activate(id)` → also `focusPane` + `setActiveTab` on the tab's pane.
- `switchWorkspace(cwd)` → `ensureWorkspace(cwd)`; the restored tab is the workspace's derived
  active (`activeTabOf`), with `lastActiveTabByWorkspace` retired in favour of the layout store's
  persisted per-pane actives + focused pane (keep the field but stop consulting it, or remove it and
  update its two readers — implementer's choice, stated in the summary).
- `activeTabId` stays as a field (dozens of consumers) but is now **written only from the layout
  derivation** — a `syncActiveFromLayout(cwd)` helper called by every mutation above. Add a
  `useIsTabVisible(tabId)` selector (pane-active ∧ pane occupied) for sprint-049 task-002.
- `syncActiveSession` keeps firing exactly as today on the derived transitions.

## Out of scope
- Rendering (task-002/003), drag-drop (task-004), affordances (task-005).
- Any change to tab ids, `tabIds`, or open-helper functions' signatures.

## Acceptance criteria
- [ ] Every existing `tab-store.test.ts` case passes without modification.
- [ ] With one pane: open/activate/close/switchWorkspace produce the same `activeTabId` sequences as
      before the change (add explicit regression cases mirroring the POC semantics).
- [ ] With two panes: closing the focused pane's last tab collapses it and `activeTabId` becomes the
      surviving pane's active tab.
- [ ] With two panes: `activate` on a tab in the unfocused pane focuses that pane; a tab active in a
      non-focused pane reports visible via `useIsTabVisible` while `activeTabId` is another tab.
- [ ] Re-opening an existing tab id focuses its pane instead of duplicating placement.
- [ ] `switchWorkspace` restores that workspace's focused pane and its active tab.
- [ ] No component/store writes `activeTabId` except the layout derivation helper.

## Test / verification plan
- Tests: extend `tab-store.test.ts` (two-pane scenarios via `layout-store` setup) and
  `layout-store.test.ts` where selectors were added. Run
  `npx vitest run packages/web-client/src/stores/`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Manual: `npm run dev:daemon` + web-client dev server — open tabs, switch workspaces, close tabs;
  behaviour indistinguishable from before (still single-pane at this task).

## Notes
- `lastActiveTabByWorkspace` retirement: the layout store's `activeByPane[focusedPaneId]` per
  workspace is the same information, now persisted. Do not maintain both as live state — that is
  exactly the drift the spec forbids.
