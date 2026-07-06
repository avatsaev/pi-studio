/**
 * Workspace tab layout store — Zustand with debounced KV persistence.
 *
 * Holds per-workspace layout (tabs, pane splits, active tab, pinned tabs).
 * Persists to KeyValueStore with debounce; restores on workspace re-open.
 * Stale tab detection: tabs referencing closed terminals / deleted files
 * are marked "stale" with a warning indicator.
 *
 * See: clean-room-scope/features/workspace-ui.md § tab layout persistence
 *      clean-room-scope/architecture/client-app-runtime.md § workspace routing
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { randomUUID } from "../util/uuid.js";
import {
  defaultWorkspaceLayout,
  openTabInFocusedPane,
  closeTabInLayout,
  focusPane,
  reorderTabInPane,
  splitTabToSide,
  moveTabBetweenPanes,
  resizeGroup,
  listPanes,
  type WorkspaceLayout,
  type SplitSide,
} from "../workspace/layout.js";
import {
  createWorkspaceTab,
  type WorkspaceTab,
  type WorkspaceTabTarget,
} from "../workspace/tabs.js";
import {
  WorkspaceLayoutStore,
  createMemoryLayoutStorage,
  type LayoutStorage,
} from "../workspace/layout-store.js";
import { nextMountedTabLru } from "../workspace/keepalive.js";

// ─── Layout constants ─────────────────────────────────────────────────────────

export const MIN_PANE_SIZE = 0.15;
export const MAX_SPLIT_DEPTH = 3;
export const DEFAULT_SPLIT_RATIO = 0.5;
export const DEBOUNCE_SAVE_MS = 400;

// ─── Tab registry ─────────────────────────────────────────────────────────────

export interface TabRecord {
  tab: WorkspaceTab;
  isPinned: boolean;
  isStale: boolean;
  staleReason?: string;
}

// ─── Per-workspace state ──────────────────────────────────────────────────────

export interface WorkspaceTabState {
  workspaceId: string;
  serverId: string;
  /** Ordered tab registry — source of truth for all tabs. */
  tabs: Record<string, TabRecord>;
  /** Ordered tab id list (for TabStrip display order). */
  tabOrder: string[];
  /** Pane split layout. */
  layout: WorkspaceLayout;
  /** LRU of mounted (keepalive) tab ids, cap 3. */
  mountedLru: string[];
  /** Whether layout has been restored from KV. */
  hydrated: boolean;
}

// ─── Store shape ──────────────────────────────────────────────────────────────

export interface WorkspaceLayoutStoreState {
  /** Per-workspace state keyed by `${serverId}:${workspaceId}`. */
  workspaces: Record<string, WorkspaceTabState>;
  /** The storage adapter (defaults to memory; swapped to localStorage in app). */
  _storage: LayoutStorage;
  /** Pending debounce timer handles keyed by workspace key. */
  _saveTimers: Record<string, ReturnType<typeof setTimeout>>;
}

export interface WorkspaceLayoutStoreActions {
  /** Initialize a workspace (seed from KV + create timeline tab if empty). */
  initWorkspace(serverId: string, workspaceId: string, agentId?: string): void;
  /** Open a tab (dedup by target). */
  openTab(serverId: string, workspaceId: string, target: WorkspaceTabTarget): string;
  /** Close a tab by id. */
  closeTab(serverId: string, workspaceId: string, tabId: string): void;
  /** Reorder tab within pane. */
  reorderTab(serverId: string, workspaceId: string, paneId: string, fromIndex: number, toIndex: number): void;
  /** Split a tab to a side. */
  splitTab(serverId: string, workspaceId: string, paneId: string, tabId: string, side: SplitSide): void;
  /** Move tab between panes. */
  moveTab(serverId: string, workspaceId: string, fromPane: string, toPane: string, tabId: string): void;
  /** Resize pane group. */
  resizePanes(serverId: string, workspaceId: string, groupId: string, sizes: number[]): void;
  /** Focus a pane. */
  focusPane(serverId: string, workspaceId: string, paneId: string): void;
  /** Pin/unpin a tab. */
  setPinned(serverId: string, workspaceId: string, tabId: string, pinned: boolean): void;
  /** Mark a tab as stale. */
  markStale(serverId: string, workspaceId: string, tabId: string, reason?: string): void;
  /** Clear stale flag. */
  clearStale(serverId: string, workspaceId: string, tabId: string): void;
  /** Update mounted LRU after tab switch. */
  activateTab(serverId: string, workspaceId: string, tabId: string): void;
  /** Swap the storage adapter (used in app bootstrap). */
  setStorage(storage: LayoutStorage): void;
}

export type WorkspaceLayoutStoreType = WorkspaceLayoutStoreState & WorkspaceLayoutStoreActions;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wsKey(serverId: string, workspaceId: string): string {
  return `${serverId}:${workspaceId}`;
}

function getOrDefault(
  state: WorkspaceLayoutStoreState,
  serverId: string,
  workspaceId: string,
): WorkspaceTabState {
  return (
    state.workspaces[wsKey(serverId, workspaceId)] ?? {
      workspaceId,
      serverId,
      tabs: {},
      tabOrder: [],
      layout: defaultWorkspaceLayout(),
      mountedLru: [],
      hydrated: false,
    }
  );
}

function scheduleSave(
  state: WorkspaceLayoutStoreState,
  serverId: string,
  workspaceId: string,
  layout: WorkspaceLayout,
): Partial<WorkspaceLayoutStoreState> {
  const key = wsKey(serverId, workspaceId);
  const existing = state._saveTimers[key];
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    new WorkspaceLayoutStore(useWorkspaceLayoutStore.getState()._storage).save(
      serverId,
      workspaceId,
      layout,
    );
  }, DEBOUNCE_SAVE_MS);
  return { _saveTimers: { ...state._saveTimers, [key]: timer } };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useWorkspaceLayoutStore = create<WorkspaceLayoutStoreType>()(
  subscribeWithSelector((set, get) => ({
    workspaces: {},
    _storage: createMemoryLayoutStorage(),
    _saveTimers: {},

    setStorage(storage) {
      set({ _storage: storage });
    },

    initWorkspace(serverId, workspaceId, agentId) {
      const key = wsKey(serverId, workspaceId);
      // Load persisted layout
      const store = new WorkspaceLayoutStore(get()._storage);
      const layout = store.load(serverId, workspaceId);

      // Determine initial tabs: if layout has panes with tabIds, restore them;
      // otherwise seed with a timeline tab for the agentId (or a draft).
      const existingTabIds = listPanes(layout.root).flatMap((p) => p.tabIds);
      const tabs: Record<string, TabRecord> = {};
      const tabOrder: string[] = [];

      if (existingTabIds.length > 0) {
        // Restore: create stub tab records from existing pane tabIds.
        // Real tab types will be rehydrated by the workspace host.
        for (const tabId of existingTabIds) {
          if (!tabs[tabId]) {
            // Try to recover target from tab id naming convention
            const target = inferTargetFromTabId(tabId, agentId);
            const tab = createWorkspaceTab(target, Date.now());
            // Override the tabId to match what was persisted
            (tab as { tabId: string }).tabId = tabId;
            tabs[tabId] = { tab, isPinned: false, isStale: false };
            tabOrder.push(tabId);
          }
        }
      } else {
        // Seed: open timeline tab for the agent
        const target: WorkspaceTabTarget = agentId
          ? { kind: "agent", agentId }
          : { kind: "draft", draftId: randomUUID(), setup: { provider: "default", cwd: "" } };
        const tab = createWorkspaceTab(target, Date.now());
        tabs[tab.tabId] = { tab, isPinned: false, isStale: false };
        tabOrder.push(tab.tabId);
        layout.root = { kind: "pane", id: "main", tabIds: [tab.tabId], focusedTabId: tab.tabId };
        layout.focusedPaneId = "main";
      }

      set((s) => ({
        workspaces: {
          ...s.workspaces,
          [key]: {
            workspaceId,
            serverId,
            tabs,
            tabOrder,
            layout,
            mountedLru: tabOrder.slice(0, 1),
            hydrated: true,
          },
        },
      }));
    },

    openTab(serverId, workspaceId, target) {
      const key = wsKey(serverId, workspaceId);
      const ws = getOrDefault(get(), serverId, workspaceId);

      // Dedup: find existing tab with same target
      const existing = Object.values(ws.tabs).find(
        (r) => r.tab.target.kind === target.kind &&
          JSON.stringify(r.tab.target) === JSON.stringify(target),
      );
      if (existing) return existing.tab.tabId;

      const tab = createWorkspaceTab(target, Date.now());
      const newLayout = openTabInFocusedPane(ws.layout, tab, "focused");
      const newTabs = { ...ws.tabs, [tab.tabId]: { tab, isPinned: false, isStale: false } };
      const newOrder = [...ws.tabOrder, tab.tabId];

      set((s) => ({
        workspaces: {
          ...s.workspaces,
          [key]: { ...ws, tabs: newTabs, tabOrder: newOrder, layout: newLayout },
        },
        ...scheduleSave(s, serverId, workspaceId, newLayout),
      }));
      return tab.tabId;
    },

    closeTab(serverId, workspaceId, tabId) {
      const key = wsKey(serverId, workspaceId);
      const ws = getOrDefault(get(), serverId, workspaceId);
      // Don't close pinned tabs
      if (ws.tabs[tabId]?.isPinned) return;

      const { [tabId]: _, ...remainingTabs } = ws.tabs;
      const newOrder = ws.tabOrder.filter((id) => id !== tabId);
      const newLayout = closeTabInLayout(ws.layout, tabId);
      const newLru = ws.mountedLru.filter((id) => id !== tabId);

      set((s) => ({
        workspaces: {
          ...s.workspaces,
          [key]: { ...ws, tabs: remainingTabs, tabOrder: newOrder, layout: newLayout, mountedLru: newLru },
        },
        ...scheduleSave(s, serverId, workspaceId, newLayout),
      }));
    },

    reorderTab(serverId, workspaceId, paneId, fromIndex, toIndex) {
      const key = wsKey(serverId, workspaceId);
      const ws = getOrDefault(get(), serverId, workspaceId);
      const newLayout = reorderTabInPane(ws.layout, paneId, fromIndex, toIndex);
      set((s) => ({
        workspaces: { ...s.workspaces, [key]: { ...ws, layout: newLayout } },
        ...scheduleSave(s, serverId, workspaceId, newLayout),
      }));
    },

    splitTab(serverId, workspaceId, paneId, tabId, side) {
      const key = wsKey(serverId, workspaceId);
      const ws = getOrDefault(get(), serverId, workspaceId);
      const newPaneId = randomUUID();
      const { layout: newLayout } = splitTabToSide(ws.layout, paneId, tabId, side, newPaneId);
      set((s) => ({
        workspaces: { ...s.workspaces, [key]: { ...ws, layout: newLayout } },
        ...scheduleSave(s, serverId, workspaceId, newLayout),
      }));
    },

    moveTab(serverId, workspaceId, fromPane, toPane, tabId) {
      const key = wsKey(serverId, workspaceId);
      const ws = getOrDefault(get(), serverId, workspaceId);
      const newLayout = moveTabBetweenPanes(ws.layout, fromPane, toPane, tabId);
      set((s) => ({
        workspaces: { ...s.workspaces, [key]: { ...ws, layout: newLayout } },
        ...scheduleSave(s, serverId, workspaceId, newLayout),
      }));
    },

    resizePanes(serverId, workspaceId, groupId, sizes) {
      const key = wsKey(serverId, workspaceId);
      const ws = getOrDefault(get(), serverId, workspaceId);
      const newLayout = resizeGroup(ws.layout, groupId, sizes);
      set((s) => ({
        workspaces: { ...s.workspaces, [key]: { ...ws, layout: newLayout } },
        ...scheduleSave(s, serverId, workspaceId, newLayout),
      }));
    },

    focusPane(serverId, workspaceId, paneId) {
      const key = wsKey(serverId, workspaceId);
      const ws = getOrDefault(get(), serverId, workspaceId);
      const newLayout = focusPane(ws.layout, paneId);
      set((s) => ({
        workspaces: { ...s.workspaces, [key]: { ...ws, layout: newLayout } },
      }));
    },

    setPinned(serverId, workspaceId, tabId, pinned) {
      const key = wsKey(serverId, workspaceId);
      const ws = getOrDefault(get(), serverId, workspaceId);
      const record = ws.tabs[tabId];
      if (!record) return;
      set((s) => ({
        workspaces: {
          ...s.workspaces,
          [key]: { ...ws, tabs: { ...ws.tabs, [tabId]: { ...record, isPinned: pinned } } },
        },
      }));
    },

    markStale(serverId, workspaceId, tabId, reason) {
      const key = wsKey(serverId, workspaceId);
      const ws = getOrDefault(get(), serverId, workspaceId);
      const record = ws.tabs[tabId];
      if (!record) return;
      set((s) => ({
        workspaces: {
          ...s.workspaces,
          [key]: {
            ...ws,
            tabs: { ...ws.tabs, [tabId]: { ...record, isStale: true, staleReason: reason } },
          },
        },
      }));
    },

    clearStale(serverId, workspaceId, tabId) {
      const key = wsKey(serverId, workspaceId);
      const ws = getOrDefault(get(), serverId, workspaceId);
      const record = ws.tabs[tabId];
      if (!record) return;
      set((s) => ({
        workspaces: {
          ...s.workspaces,
          [key]: {
            ...ws,
            tabs: { ...ws.tabs, [tabId]: { ...record, isStale: false, staleReason: undefined } },
          },
        },
      }));
    },

    activateTab(serverId, workspaceId, tabId) {
      const key = wsKey(serverId, workspaceId);
      const ws = getOrDefault(get(), serverId, workspaceId);
      const newLru = nextMountedTabLru(ws.mountedLru, tabId, 3);
      // Also update layout focusedTabId in the containing pane
      const panes = listPanes(ws.layout.root);
      let newLayout = ws.layout;
      for (const pane of panes) {
        if (pane.tabIds.includes(tabId)) {
          newLayout = focusPane(
            { ...ws.layout, root: updatePaneFocusedTab(ws.layout.root, pane.id, tabId) },
            pane.id,
          );
          break;
        }
      }
      set((s) => ({
        workspaces: { ...s.workspaces, [key]: { ...ws, layout: newLayout, mountedLru: newLru } },
      }));
    },
  })),
);

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useWorkspaceTabState(
  serverId: string | undefined,
  workspaceId: string | undefined,
): WorkspaceTabState | undefined {
  return useWorkspaceLayoutStore((s) =>
    serverId && workspaceId ? s.workspaces[wsKey(serverId, workspaceId)] : undefined,
  );
}

export function useActiveTabId(
  serverId: string | undefined,
  workspaceId: string | undefined,
): string | undefined {
  return useWorkspaceLayoutStore((s) => {
    if (!serverId || !workspaceId) return undefined;
    const ws = s.workspaces[wsKey(serverId, workspaceId)];
    if (!ws) return undefined;
    const focusedPane = listPanes(ws.layout.root).find(
      (p) => p.id === ws.layout.focusedPaneId,
    );
    return focusedPane?.focusedTabId ?? focusedPane?.tabIds[0];
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferTargetFromTabId(tabId: string, agentId?: string): WorkspaceTabTarget {
  if (tabId.startsWith("agent_") && agentId) return { kind: "agent", agentId };
  if (tabId.startsWith("terminal_")) return { kind: "terminal", terminalId: tabId.slice(9) };
  if (tabId.startsWith("browser_")) return { kind: "browser", browserId: tabId.slice(8) };
  if (tabId.startsWith("file_")) return { kind: "file", path: tabId.slice(5) };
  if (tabId.startsWith("setup_")) return { kind: "setup", workspaceId: tabId.slice(6) };
  // Fallback: draft
  return { kind: "draft", draftId: tabId, setup: { provider: "default", cwd: "" } };
}

function updatePaneFocusedTab(
  node: import("../workspace/layout.js").SplitNode,
  paneId: string,
  tabId: string,
): import("../workspace/layout.js").SplitNode {
  if (node.kind === "pane") {
    return node.id === paneId ? { ...node, focusedTabId: tabId } : node;
  }
  return {
    ...node,
    children: node.children.map((c) => updatePaneFocusedTab(c, paneId, tabId)),
  };
}
