/**
 * Layout store — pane structure per workspace: the pane tree, which pane holds each tab, each
 * pane's active tab, and which pane is focused.
 *
 * **Division of labour with `tab-store`.** The spec requires one owner for the tab↔pane invariant,
 * never two mutable directions that can drift:
 *
 *  - `tab-store` remains the single owner of tab identity and *global* tab order. A pane's tab order
 *    is **derived** — the global order filtered by pane membership — so reordering within a pane
 *    stays `tab-store.reorder` and there is no second order to fall out of sync.
 *  - this store owns pane structure: `tree`, `placement` (tab id → pane id), `activeByPane`, and
 *    `focusedPaneId`, keyed by normalized workspace cwd.
 *  - the workspace-active tab is **derived** (`activeTabOf` = `activeByPane[focusedPaneId]`), never
 *    stored — a stored duplicate can drift and point at an invisible tab.
 *
 * Because per-pane order lives in `tab-store`, the operations that must pick a fallback active tab
 * accept an optional `order` argument: the workspace's tab ids in global order. Callers that have it
 * (sprint-049's `tab-store` wiring) pass it so the fallback matches the strip the user sees; without
 * it the store falls back to `placement` insertion order, which is deterministic but not necessarily
 * the visible order.
 *
 * **Restore is claim-driven.** Tabs are not persisted — they are rebuilt from daemon state on
 * connect by two independent one-shot hooks, in no guaranteed order. So `installPersistedLayouts`
 * installs geometry immediately and holds the persisted `placement`/`activeByPane` as *pending
 * claims*, which `claimPaneFor` consumes as each tab arrives.
 *
 * The settle point (`markHydrationSource`) does more than cleanup, though: while it is still
 * pending, `claimPaneFor` refuses to let an UNCLAIMED arrival (an orphaned terminal the daemon
 * still has, a chat nothing persisted claimed) steal an already-occupied pane's active slot —
 * only a claim, or a genuinely empty pane, may take one. Without that guard, two independent
 * restore hooks racing in undefined order meant a terminal-restore arrival could silently replace
 * a chat a claim had *just* placed a moment earlier in the same pass — restore noise overwriting a
 * deliberate arrangement. After the settle point this restriction lifts: a live "+"/Ctrl+T open
 * into the focused pane taking it over immediately is the correct, expected behaviour.
 *
 * swe/features/workspace-split-panes.md § Tab ↔ pane assignment, § Splitting,
 * § Programmatic splits, § Moving a tab between panes, § Removing a pane / collapsing,
 * § Restoring a persisted layout
 */

import { create } from "zustand";
import {
  canSplit,
  leafIds,
  removePane,
  resizeAtDivider,
  splitPane,
  type PaneNode,
  type SplitPath,
  type SplitRegion,
} from "@pi-studio-ui/features/workspace/pane-tree.js";
import type { ValidatedWorkspaceLayout } from "@pi-studio-ui/lib/pane-layout-persistence.js";
import { randomId } from "@pi-studio-ui/lib/random-id.js";

export interface WorkspacePaneLayout {
  tree: PaneNode;
  /** tab id → pane id. The single owner of the tab↔pane invariant. */
  placement: Record<string, string>;
  /** pane id → that pane's active tab id. Every value is placed in its own pane. */
  activeByPane: Record<string, string>;
  /** Always a leaf id present in `tree`. */
  focusedPaneId: string;

  // ── Restore state: session-local, never persisted ──
  /** Unconsumed persisted claims: tab identity → pane id. Emptied at the settle point. */
  pendingPlacement: Record<string, string>;
  /** Which identity each pane wants as its active tab. Held until the settle point. */
  pendingActive: Record<string, string>;
  /** Panes whose active tab the user chose directly — a claim must never displace it. */
  userActedPanes: ReadonlySet<string>;
}

/** The connect-time inventories whose arrival together means initial hydration is complete. */
export type HydrationSource = "sessions" | "terminals";
const HYDRATION_SOURCES: readonly HydrationSource[] = ["sessions", "terminals"];

export interface LayoutStoreState {
  /** Keyed by normalized workspace cwd (`workspace-grouping.ts#normalizeCwd`). */
  layouts: Record<string, WorkspacePaneLayout>;
  /** Which restore sources have reported. Hydration is complete once every one is `true`. */
  hydrationSources: Readonly<Record<HydrationSource, boolean>>;
  /** Whether a restore cycle is in flight — `true` from `installPersistedLayouts` until hydration
   * settles. Distinct from `!every(hydrationSources)`, which is also true before any restore cycle
   * has ever started (e.g. every unit test that never calls `installPersistedLayouts`); this field
   * exists so `claimPaneFor`'s restore-time guard only restricts unclaimed arrivals during an actual
   * restore, never ordinary live use. */
  restoring: boolean;
  /**
   * The workspace that was in view when the record was written, captured at boot and held until the
   * settle point — `null` when nothing was persisted.
   *
   * Captured rather than re-read on demand: `writePaneLayout` persists `activeWorkspaceCwd` from the
   * *current* tab-store value and writes fire throughout the restore window, so a mid-restore write
   * can clobber the stored target before a later reader gets to it. Consumers that must agree on
   * which workspace restore is heading for (`use-session-restore.ts`'s sidebar/explorer seeding, and
   * `restore-active-workspace.ts`'s view switch) read this one captured value instead of racing
   * localStorage.
   */
  pendingActiveWorkspace: string | null;

  /** Create the single-leaf default on first touch; idempotent. */
  ensureWorkspace(cwd: string): void;
  /**
   * Place a tab: the explicit pane when it exists, else the focused pane, else the first leaf.
   * Makes it that pane's active tab and focuses the pane unless `background`.
   */
  assignTab(
    cwd: string,
    tabId: string,
    paneId?: string,
    background?: boolean,
    order?: readonly string[],
  ): void;
  /**
   * Move a tab into another pane: activate it there, focus that pane, fall the source pane's active
   * tab back to its nearest remaining sibling, and remove the source pane if it is now empty.
   * A move into the pane the tab already occupies is a no-op — cross-pane reorder is `tab-store`'s.
   */
  moveTab(cwd: string, tabId: string, targetPaneId: string, order?: readonly string[]): void;
  /**
   * Split `targetPaneId` and move `tabId` into the new pane. No-op when the split is illegal or the
   * tab is the target pane's only tab — the new pane would immediately collapse, so nothing should
   * visibly happen.
   */
  splitWithTab(
    cwd: string,
    tabId: string,
    targetPaneId: string,
    region: SplitRegion,
    order?: readonly string[],
  ): void;
  /**
   * Split only, returning the new (focused, empty) pane id, or `null` when refused. The caller opens
   * a tab into it immediately — an empty pane cannot exist at rest.
   */
  splitEmpty(cwd: string, targetPaneId: string, region: SplitRegion): string | null;
  /** Drop a closed tab; an emptied pane collapses, except the last one or one still under claim. */
  removeTab(cwd: string, tabId: string, order?: readonly string[]): void;
  /** Set a pane's active tab *without* focusing it — restore needs to do exactly that. */
  setActiveTab(cwd: string, paneId: string, tabId: string): void;
  focusPane(cwd: string, paneId: string): void;
  resizeDivider(
    cwd: string,
    splitPath: SplitPath,
    boundaryIndex: number,
    deltaFraction: number,
  ): void;

  /** Install persisted geometry up front and hold its placement as pending claims, plus the
   *  workspace that was in view, as `pendingActiveWorkspace`. */
  installPersistedLayouts(
    loaded: ReadonlyMap<string, ValidatedWorkspaceLayout>,
    activeWorkspaceCwd?: string | null,
  ): void;
  /**
   * Resolve the pane an arriving tab belongs in, consuming a matching claim. The single entry point
   * for every tab open, restored or user-initiated.
   */
  claimPaneFor(cwd: string, tabId: string, identity: string | null, paneId?: string): void;
  /**
   * Report that one restore source has finished. Once every source has, unconsumed claims are
   * discarded and unclaimed panes are pruned from the stored tree.
   */
  markHydrationSource(source: HydrationSource): void;

  paneOfTab(cwd: string, tabId: string): string | null;
  /** The workspace's active tab, derived from the focused pane. */
  activeTabOf(cwd: string): string | null;
}

// ─── Layout helpers (pure) ─────────────────────────────────────────────────────────────────

/** Unique per tree, and never derived from a tab id — a pane outlives the tabs that pass through. */
function mintPaneId(): string {
  return `pane-${randomId()}`;
}

export function createPaneLayout(): WorkspacePaneLayout {
  const id = mintPaneId();
  return {
    tree: { kind: "leaf", id },
    placement: {},
    activeByPane: {},
    focusedPaneId: id,
    pendingPlacement: {},
    pendingActive: {},
    userActedPanes: new Set(),
  };
}

/** A pane's tabs in the caller's order (global tab order filtered by pane membership). */
function tabsInPane(
  layout: WorkspacePaneLayout,
  paneId: string,
  order?: readonly string[],
): string[] {
  const ids = order ?? Object.keys(layout.placement);
  return ids.filter((id) => layout.placement[id] === paneId);
}

/** The tab that should take over as active, mirroring `tab-store.close`'s nearest-by-index rule. */
function nearestSibling(
  layout: WorkspacePaneLayout,
  paneId: string,
  leavingTabId: string,
  order?: readonly string[],
): string | undefined {
  const tabs = tabsInPane(layout, paneId, order);
  const index = tabs.indexOf(leavingTabId);
  const remaining = tabs.filter((id) => id !== leavingTabId);
  if (remaining.length === 0) return undefined;
  return remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
}

/**
 * Whether some persisted claim still points at this pane.
 *
 * Self-disabling: the settle point empties both pending maps, so after initial hydration this is
 * always `false` and imposes no cost on ordinary closes.
 */
function hasPendingClaim(layout: WorkspacePaneLayout, paneId: string): boolean {
  if (layout.pendingActive[paneId] !== undefined) return true;
  return Object.values(layout.pendingPlacement).includes(paneId);
}

/**
 * Remove an **empty** pane and keep the invariants: its `activeByPane` entry goes with it, and focus
 * lands on a survivor. Only ever called for a pane with no tabs, so no `placement` entry can be left
 * pointing at a pane that is gone.
 *
 * Refuses while a claim still names the pane: restore is asynchronous, and closing some other tab
 * early must not destroy the pane of a terminal whose daemon listing has not arrived yet.
 */
function withPaneRemoved(layout: WorkspacePaneLayout, paneId: string): WorkspacePaneLayout {
  if (hasPendingClaim(layout, paneId)) return layout;
  const tree = removePane(layout.tree, paneId);
  if (tree === layout.tree) return layout; // the last pane is kept and renders the empty state
  const activeByPane = { ...layout.activeByPane };
  delete activeByPane[paneId];
  const leaves = leafIds(tree);
  return {
    ...layout,
    tree,
    activeByPane,
    focusedPaneId: leaves.includes(layout.focusedPaneId) ? layout.focusedPaneId : leaves[0]!,
  };
}

/**
 * Reassign `tabId` to `pane`, cleaning up whatever pane it came from. The single write path for
 * `assignTab`, `moveTab`, and `claimPaneFor`, which is what makes "every `activeByPane` value is
 * placed in its own pane" hold by construction rather than by later repair.
 *
 * `activate` and `focus` are separate because a claim-driven arrival may legitimately become its
 * pane's active tab without moving focus — the persisted `activePaneId` already decided that.
 */
function placeTab(
  layout: WorkspacePaneLayout,
  tabId: string,
  pane: string,
  options: { activate: boolean; focus: boolean; order?: readonly string[] },
): WorkspacePaneLayout {
  const source = layout.placement[tabId];
  const placement = { ...layout.placement, [tabId]: pane };
  const activeByPane = { ...layout.activeByPane };
  if (options.activate) activeByPane[pane] = tabId;

  if (source !== undefined && source !== pane && activeByPane[source] === tabId) {
    const next = nearestSibling(layout, source, tabId, options.order);
    if (next === undefined) delete activeByPane[source];
    else activeByPane[source] = next;
  }

  const moved: WorkspacePaneLayout = {
    ...layout,
    placement,
    activeByPane,
    focusedPaneId: options.focus ? pane : layout.focusedPaneId,
  };
  const sourceIsEmpty =
    source !== undefined && source !== pane && !Object.values(placement).includes(source);
  return sourceIsEmpty ? withPaneRemoved(moved, source) : moved;
}

/** Mark a pane's active tab as user-chosen, so no later claim displaces it. */
function withUserAction(layout: WorkspacePaneLayout, paneId: string): WorkspacePaneLayout {
  if (layout.userActedPanes.has(paneId)) return layout;
  return { ...layout, userActedPanes: new Set(layout.userActedPanes).add(paneId) };
}

/**
 * Initial hydration is complete: drop every unconsumed claim, prune the panes no tab ever claimed,
 * and give any pane holding tabs but no active tab one — its wanted identity never arrived.
 */
function settleWorkspace(layout: WorkspacePaneLayout): WorkspacePaneLayout {
  // Claims go first, which is what lets `withPaneRemoved` stop refusing below.
  let settled: WorkspacePaneLayout = { ...layout, pendingPlacement: {}, pendingActive: {} };

  const occupied = new Set(Object.values(settled.placement));
  for (const paneId of leafIds(settled.tree)) {
    if (!occupied.has(paneId)) settled = withPaneRemoved(settled, paneId);
  }

  const activeByPane = { ...settled.activeByPane };
  let repaired = false;
  for (const paneId of leafIds(settled.tree)) {
    if (activeByPane[paneId] !== undefined) continue;
    const first = Object.keys(settled.placement).find((id) => settled.placement[id] === paneId);
    if (first !== undefined) {
      activeByPane[paneId] = first;
      repaired = true;
    }
  }
  return repaired ? { ...settled, activeByPane } : settled;
}

/**
 * Whether `tabId` is its own pane's active tab — the per-pane visibility test panels apply, as
 * opposed to `tab-store.activeTabId`, which names one tab per *workspace*. Pure, so it is testable
 * without a DOM; `tab-store.useIsTabVisible` is the subscribing wrapper.
 */
export function isPaneActiveTab(layout: WorkspacePaneLayout | undefined, tabId: string): boolean {
  if (layout === undefined) return false;
  const pane = layout.placement[tabId];
  return pane !== undefined && layout.activeByPane[pane] === tabId;
}

// ─── Store ─────────────────────────────────────────────────────────────────────────────────

export const useLayoutStore = create<LayoutStoreState>()((set, get) => {
  /**
   * Apply a pure layout transform, materializing the workspace's default layout on first touch.
   * `fn` returning `null` means "no change".
   */
  const update = (
    cwd: string,
    fn: (layout: WorkspacePaneLayout) => WorkspacePaneLayout | null,
  ): void => {
    set((s) => {
      const current = s.layouts[cwd] ?? createPaneLayout();
      const next = fn(current) ?? current;
      if (next === s.layouts[cwd]) return s;
      return { layouts: { ...s.layouts, [cwd]: next } };
    });
  };

  return {
    layouts: {},
    hydrationSources: { sessions: false, terminals: false },
    restoring: false,
    pendingActiveWorkspace: null,

    ensureWorkspace(cwd) {
      set((s) => (s.layouts[cwd] ? s : { layouts: { ...s.layouts, [cwd]: createPaneLayout() } }));
    },

    assignTab(cwd, tabId, paneId, background, order) {
      update(cwd, (layout) => {
        const leaves = leafIds(layout.tree);
        const pane =
          paneId !== undefined && leaves.includes(paneId)
            ? paneId
            : leaves.includes(layout.focusedPaneId)
              ? layout.focusedPaneId
              : leaves[0]!;
        const activate = background !== true;
        const placed = placeTab(layout, tabId, pane, { activate, focus: activate, order });
        return activate ? withUserAction(placed, pane) : placed;
      });
    },

    moveTab(cwd, tabId, targetPaneId, order) {
      update(cwd, (layout) => {
        if (layout.placement[tabId] === undefined) return null;
        if (layout.placement[tabId] === targetPaneId) return null;
        if (!leafIds(layout.tree).includes(targetPaneId)) return null;
        const placed = placeTab(layout, tabId, targetPaneId, {
          activate: true,
          focus: true,
          order,
        });
        return withUserAction(placed, targetPaneId);
      });
    },

    splitWithTab(cwd, tabId, targetPaneId, region, order) {
      update(cwd, (layout) => {
        if (!leafIds(layout.tree).includes(targetPaneId)) return null;
        if (!canSplit(layout.tree, targetPaneId, region)) return null;
        // The dragged tab being the target pane's only tab means the new pane would take it and the
        // source would collapse right back — a no-op, and it must not flash.
        const targetTabs = tabsInPane(layout, targetPaneId, order);
        if (targetTabs.length === 1 && targetTabs[0] === tabId) return null;

        const newPaneId = mintPaneId();
        const tree = splitPane(layout.tree, targetPaneId, region, newPaneId);
        if (tree === layout.tree) return null;
        const placed = placeTab({ ...layout, tree }, tabId, newPaneId, {
          activate: true,
          focus: true,
          order,
        });
        return withUserAction(placed, newPaneId);
      });
    },

    splitEmpty(cwd, targetPaneId, region) {
      let created: string | null = null;
      update(cwd, (layout) => {
        if (!leafIds(layout.tree).includes(targetPaneId)) return null;
        if (!canSplit(layout.tree, targetPaneId, region)) return null;
        const newPaneId = mintPaneId();
        const tree = splitPane(layout.tree, targetPaneId, region, newPaneId);
        if (tree === layout.tree) return null;
        created = newPaneId;
        return { ...layout, tree, focusedPaneId: newPaneId };
      });
      return created;
    },

    removeTab(cwd, tabId, order) {
      update(cwd, (layout) => {
        const pane = layout.placement[tabId];
        if (pane === undefined) return null;

        const placement = { ...layout.placement };
        delete placement[tabId];
        const activeByPane = { ...layout.activeByPane };
        if (activeByPane[pane] === tabId) {
          const next = nearestSibling(layout, pane, tabId, order);
          if (next === undefined) delete activeByPane[pane];
          else activeByPane[pane] = next;
        }

        const closed: WorkspacePaneLayout = { ...layout, placement, activeByPane };
        return Object.values(placement).includes(pane) ? closed : withPaneRemoved(closed, pane);
      });
    },

    setActiveTab(cwd, paneId, tabId) {
      update(cwd, (layout) => {
        if (layout.placement[tabId] !== paneId) return null;
        if (layout.activeByPane[paneId] === tabId) return withUserAction(layout, paneId);
        return withUserAction(
          { ...layout, activeByPane: { ...layout.activeByPane, [paneId]: tabId } },
          paneId,
        );
      });
    },

    focusPane(cwd, paneId) {
      update(cwd, (layout) => {
        if (layout.focusedPaneId === paneId) return null;
        if (!leafIds(layout.tree).includes(paneId)) return null;
        return { ...layout, focusedPaneId: paneId };
      });
    },

    resizeDivider(cwd, splitPath, boundaryIndex, deltaFraction) {
      update(cwd, (layout) => {
        const tree = resizeAtDivider(layout.tree, splitPath, boundaryIndex, deltaFraction);
        return tree === layout.tree ? null : { ...layout, tree };
      });
    },

    installPersistedLayouts(loaded, activeWorkspaceCwd = null) {
      set((s) => {
        const layouts = { ...s.layouts };
        for (const [cwd, entry] of loaded) {
          const leaves = leafIds(entry.tree);
          layouts[cwd] = {
            tree: entry.tree,
            placement: {},
            activeByPane: {},
            focusedPaneId:
              entry.activePaneId !== null && leaves.includes(entry.activePaneId)
                ? entry.activePaneId
                : leaves[0]!,
            pendingPlacement: { ...entry.placement },
            pendingActive: { ...entry.activeByPane },
            userActedPanes: new Set(),
          };
        }
        // A fresh install starts a fresh hydration cycle.
        return {
          layouts,
          hydrationSources: { sessions: false, terminals: false },
          restoring: true,
          // Only a workspace whose entry survived validation is worth heading for.
          pendingActiveWorkspace:
            activeWorkspaceCwd !== null && layouts[activeWorkspaceCwd] !== undefined
              ? activeWorkspaceCwd
              : null,
        };
      });
    },

    claimPaneFor(cwd, tabId, identity, paneId) {
      update(cwd, (layout) => {
        const leaves = leafIds(layout.tree);

        let pane: string | undefined;
        let fromClaim = false;
        if (paneId !== undefined && leaves.includes(paneId)) {
          pane = paneId;
        } else if (identity !== null) {
          const claimed = layout.pendingPlacement[identity];
          if (claimed !== undefined && leaves.includes(claimed)) {
            pane = claimed;
            fromClaim = true;
          }
        }
        pane ??= leaves.includes(layout.focusedPaneId) ? layout.focusedPaneId : leaves[0]!;

        let base = layout;
        if (fromClaim && identity !== null) {
          const pendingPlacement = { ...layout.pendingPlacement };
          delete pendingPlacement[identity]; // the claim is spent either way
          base = { ...layout, pendingPlacement };
        }

        // Never steal what the user chose, and never displace the identity this pane is waiting for.
        // A pane with no active tab yet always takes the arrival, so it is never left blank — when
        // the wanted identity turns up later it takes over, making the outcome order-independent.
        let activate = true;
        if (fromClaim) {
          const wanted = base.pendingActive[pane];
          if (base.userActedPanes.has(pane)) activate = false;
          else if (wanted !== undefined && wanted !== identity) {
            activate = base.activeByPane[pane] === undefined;
          }
        } else if (get().restoring) {
          // An UNCLAIMED arrival while hydration is still running is restore noise, not a user
          // action — an orphaned terminal the daemon still has, or a chat with no persisted claim
          // for it. It may still open (so nothing leaks silently), but it must never steal an
          // already-occupied pane's active slot out from under a claim that placed something there
          // moments earlier in this same restore pass; it only takes over a genuinely empty pane.
          // Once hydration completes this no longer applies — a live "+"/Ctrl+T open into the
          // focused pane taking it over immediately is exactly the correct, expected behaviour.
          activate = base.activeByPane[pane] === undefined;
        }

        const placed = placeTab(base, tabId, pane, {
          activate,
          // A claim-driven arrival never moves focus: the persisted `activePaneId` already chose it.
          focus: !fromClaim && activate,
        });
        return fromClaim ? placed : withUserAction(placed, pane);
      });
    },

    markHydrationSource(source) {
      set((s) => {
        if (s.hydrationSources[source]) return s;
        const hydrationSources = { ...s.hydrationSources, [source]: true };
        if (!HYDRATION_SOURCES.every((required) => hydrationSources[required])) {
          return { hydrationSources };
        }
        const layouts: Record<string, WorkspacePaneLayout> = {};
        for (const [cwd, layout] of Object.entries(s.layouts)) {
          layouts[cwd] = settleWorkspace(layout);
        }
        return { hydrationSources, layouts, restoring: false, pendingActiveWorkspace: null };
      });
    },

    paneOfTab(cwd, tabId) {
      return get().layouts[cwd]?.placement[tabId] ?? null;
    },

    activeTabOf(cwd) {
      const layout = get().layouts[cwd];
      if (!layout) return null;
      return layout.activeByPane[layout.focusedPaneId] ?? null;
    },
  };
});
