/**
 * Tab store — replaces the POC's `tabs[]`/`activeTabId` globals + `addTab`/`closeTab`/
 * `activateTab` (POC_TO_APP_PLAN_UI.md §4.2). `TabPanelHost` keeps inactive panels mounted but
 * hidden, so this store only tracks identity/order/label — not panel content.
 *
 * Tabs are scoped by workspace (§4.3/§4.7 follow-up: workspace-scoped tabs): every `Tab` carries
 * the (already `normalizeCwd`-normalized) workspace cwd it belongs to, and `activeWorkspaceCwd`
 * names which workspace's tabs `TabStrip`/`TabPanelHost` currently render. All tabs stay mounted
 * regardless of workspace — same "hidden but alive" model that already preserves terminal/scroll
 * state across in-workspace tab switches — only the visible SUBSET changes on a workspace switch.
 *
 * **`activeTabId` is derived, not owned.** Since sprint-049 every lifecycle mutation here goes
 * through `layout-store`, which owns pane structure: which pane holds each tab, each pane's active
 * tab, and which pane is focused. The workspace-active tab is that focused pane's active tab, and
 * this store's `activeTabId` field is a cached projection of it written by `syncActiveFromLayout`
 * alone — the dozens of `activeTabId` consumers keep working, without a second mutable truth that
 * can drift. A per-workspace "last active tab" map used to live here; the layout store's focused
 * pane + per-pane actives are the same information, now persisted across reloads, so it is gone.
 *
 * With splits, "active" and "visible" part company: a pane's active tab is visible even when
 * another pane is focused. Panels therefore ask `useIsTabVisible`, not `=== activeTabId`.
 */

import { create } from "zustand";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { ensureMaterialized, discardIfEmpty } from "@pi-studio-ui/stores/materialize.js";
import { isPaneActiveTab, useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";

export type TabKind = "chat" | "file" | "diff" | "terminal" | "molecule";

export interface FileTabData {
  path: string;
}

export interface DiffTabData {
  path: string;
  staged: boolean;
}

export interface ChatTabData {
  sessionId: string;
}

export interface TerminalTabData {
  slot: number | null;
  /** Cwd captured at shortcut-fire time — the terminal launches here regardless of which
   * session/workspace becomes active before its `create_terminal_request` resolves. */
  cwd: string;
}

/** `path: null` is the empty ("+"-menu) molecule tab — molviewer's own drag-drop empty state. */
export interface MoleculeTabData {
  path: string | null;
}

export type TabData = ChatTabData | FileTabData | DiffTabData | TerminalTabData | MoleculeTabData;

export interface Tab {
  id: string;
  kind: TabKind;
  label: string;
  closable: boolean;
  data: TabData;
  /** Normalized workspace cwd this tab belongs to (see `workspace-grouping.ts#normalizeCwd`) —
   * fixed at creation time, never re-derived live from whatever session happens to be active. */
  workspaceCwd: string;
}

interface TabStoreState {
  tabs: Tab[];
  /** The focused pane's active tab, projected from `layout-store` — see the module header. */
  activeTabId: string | null;
  /** Which workspace's tabs are currently visible in the strip/panel host. */
  activeWorkspaceCwd: string | null;

  /** Open a tab, or activate it if a tab with the same `id` already exists (POC `addTab`).
   * Always brings the tab's workspace into view. `targetPaneId` places it in a specific pane
   * (a pane's own "+" menu, or the pane a Split right/down just created); the default is the
   * focused pane. */
  open(tab: Tab, targetPaneId?: string): void;
  close(id: string): void;
  /** Activate a tab by id, bringing its workspace into view too. */
  activate(id: string): void;
  /** Switch the visible workspace, restoring its focused pane's active tab (or none). */
  switchWorkspace(cwd: string): void;
  reorder(fromId: string, toId: string): void;
  updateLabel(id: string, label: string): void;
  updateData(id: string, data: Partial<TabData>): void;
  /** Close every file/diff/molecule tab whose path is `prefix` or nested under it (e.g. a
   * directory delete closing every open tab underneath — `FileContextMenu.tsx`'s `remove()`).
   * No-op for chat/terminal tabs, which have no filesystem path. */
  closeByPathPrefix(prefix: string): void;
}

function tabsInWorkspace(tabs: Tab[], cwd: string): Tab[] {
  return tabs.filter((t) => t.workspaceCwd === cwd);
}

/** The strip order the layout store's nearest-sibling fallbacks need: global order, one workspace. */
function workspaceOrder(tabs: Tab[], cwd: string): string[] {
  return tabsInWorkspace(tabs, cwd).map((t) => t.id);
}

/**
 * The single writer of `activeTabId`: recompute it from the layout store's focused pane and bring
 * `cwd` into view. Returns the tab it now names, for the sidebar sync.
 */
function syncActiveFromLayout(cwd: string | null): Tab | undefined {
  const activeTabId = cwd === null ? null : useLayoutStore.getState().activeTabOf(cwd);
  useTabStore.setState({ activeTabId, activeWorkspaceCwd: cwd });
  if (activeTabId === null) return undefined;
  return useTabStore.getState().tabs.find((t) => t.id === activeTabId);
}

/** Keep the sidebar's `session-store.activeSessionId` in lockstep with whichever chat tab is
 * now active, so switching tabs in the center pane highlights the matching sidebar row exactly
 * as if it had been clicked there directly. No-op for non-chat tabs (file/diff/terminal) — the
 * sidebar simply keeps showing whichever chat was last active. */
function syncActiveSession(tab: Tab | undefined): void {
  if (tab?.kind !== "chat") return;
  useSessionStore.getState().activate((tab.data as ChatTabData).sessionId);
}

export const useTabStore = create<TabStoreState>()((set, get) => ({
  tabs: [],
  activeTabId: null,
  activeWorkspaceCwd: null,

  open(tab, targetPaneId) {
    const existing = get().tabs.find((t) => t.id === tab.id);
    if (existing) {
      get().activate(existing.id);
      return;
    }
    set((s) => ({ tabs: [...s.tabs, tab] }));
    const layout = useLayoutStore.getState();
    layout.ensureWorkspace(tab.workspaceCwd);
    // Every arrival — user-opened or restore-driven — resolves its pane here: the explicit target
    // when given, else a persisted claim naming it, else the focused pane. A claimed arrival may
    // land in a non-focused pane, which is why the sidebar syncs to whatever is active *afterwards*
    // rather than to `tab` itself.
    layout.claimPaneFor(tab.workspaceCwd, tab.id, tabIdentity(tab), targetPaneId);
    syncActiveSession(syncActiveFromLayout(tab.workspaceCwd));
  },

  close(id) {
    const closed = get().tabs.find((t) => t.id === id);
    if (!closed) return;
    // Captured before the removal: the layout store's fallback needs the leaving tab's own position
    // among its pane's tabs to pick the nearest survivor.
    const order = workspaceOrder(get().tabs, closed.workspaceCwd);
    const before = get().activeTabId;

    set((s) => ({ tabs: s.tabs.filter((t) => t.id !== id) }));
    useLayoutStore.getState().removeTab(closed.workspaceCwd, id, order);

    // The visible workspace never changes on a close, so the derivation stays on it — closing a tab
    // must not jump the workspace out from under the user.
    const next = syncActiveFromLayout(get().activeWorkspaceCwd);
    if (get().activeTabId !== before) syncActiveSession(next);
  },

  activate(id) {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    const layout = useLayoutStore.getState();
    layout.ensureWorkspace(tab.workspaceCwd);
    const pane = layout.paneOfTab(tab.workspaceCwd, id);
    if (pane === null) {
      // No placement yet (a tab opened before its workspace had a layout) — resolve one now.
      layout.claimPaneFor(tab.workspaceCwd, id, tabIdentity(tab));
    } else {
      layout.focusPane(tab.workspaceCwd, pane);
      layout.setActiveTab(tab.workspaceCwd, pane, id);
    }
    syncActiveSession(syncActiveFromLayout(tab.workspaceCwd));
  },

  switchWorkspace(cwd) {
    useLayoutStore.getState().ensureWorkspace(cwd);
    // The workspace's focused pane and that pane's active tab ARE its remembered tab — persisted by
    // `pane-layout-persistence`, which is why no separate last-active map lives here any more.
    syncActiveSession(syncActiveFromLayout(cwd));
  },

  reorder(fromId, toId) {
    set((s) => {
      const fromIdx = s.tabs.findIndex((t) => t.id === fromId);
      const toIdx = s.tabs.findIndex((t) => t.id === toId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return s;
      const tabs = s.tabs.slice();
      const [moved] = tabs.splice(fromIdx, 1);
      if (!moved) return s;
      tabs.splice(toIdx, 0, moved);
      return { tabs };
    });
  },

  updateLabel(id, label) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, label } : t)) }));
  },

  updateData(id, data) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, data: { ...t.data, ...data } } : t)),
    }));
  },

  closeByPathPrefix(prefix) {
    const matches = get().tabs.filter((t) => {
      if (t.kind !== "file" && t.kind !== "diff" && t.kind !== "molecule") return false;
      const path = (t.data as FileTabData | DiffTabData | MoleculeTabData).path;
      return path === prefix || (path?.startsWith(`${prefix}/`) ?? false);
    });
    for (const t of matches) get().close(t.id);
  },
}));

// ─── Identity & visibility ─────────────────────────────────────────────────────────────────

/**
 * A tab's stable cross-session identity, or `null` when it has none yet. Identity — not tab id — is
 * what `pane-layout-persistence` keys a pane assignment on, because ids are not stable across a
 * reconnect: `openNewTerminal` mints `term-new-<n>` while `use-terminal-restore` reopens the same
 * terminal as `term-<slot>`. Keys are kind-prefixed, so a `file` and a `molecule` tab on the same
 * absolute path cannot collide. Identity-less tabs (a terminal awaiting its daemon slot, an empty
 * molecule tab) are simply omitted from the record — there is nothing to restore them against.
 *
 * Lives here rather than in `pane-layout-persistence` because `tab-store` must call it on every
 * open, and that module already depends on this one.
 */
export function tabIdentity(tab: Tab): string | null {
  switch (tab.kind) {
    case "chat": {
      // NOT the session id: that is client-local and regenerated on every load (`s-<seq>` when
      // created here, `s-<agentId prefix>` when restored — `use-session-restore.ts`), so a chat's
      // pane would never be recognised after a reload. The daemon-side agent id is the stable name;
      // a draft whose `createAgent` has not landed yet has no identity to persist (a window of one
      // RPC — `materialize.ts` binds it right after the tab appears).
      const { sessionId } = tab.data as ChatTabData;
      const agentId = useSessionStore.getState().sessions[sessionId]?.agentId;
      return agentId ? `agent:${agentId}` : null;
    }
    case "file":
      return `file:${(tab.data as FileTabData).path}`;
    case "diff": {
      const { path, staged } = tab.data as DiffTabData;
      return `diff:${staged ? "staged" : "worktree"}:${path}`;
    }
    case "terminal": {
      const { slot } = tab.data as TerminalTabData;
      return slot === null ? null : `terminal:${slot}`;
    }
    case "molecule": {
      const { path } = tab.data as MoleculeTabData;
      return path === null ? null : `molecule:${path}`;
    }
  }
}

/** Shared "workspace in view AND own pane's active tab" resolution behind both
 *  `useIsTabVisible` and `isTabVisible` below — returns the tab's cwd when it counts as visible,
 *  `null` otherwise (including when no tab with this id exists at all, e.g. no chat tab ever
 *  opened for a session — sprint-069/task-007's background/no-tab case). */
function tabVisibilityCwd(
  tabs: Tab[],
  activeWorkspaceCwd: string | null,
  tabId: string,
): string | null {
  return tabs.find((t) => t.id === tabId)?.workspaceCwd === activeWorkspaceCwd
    ? activeWorkspaceCwd
    : null;
}

/**
 * Whether a tab is on screen: its workspace is in view **and** it is its own pane's active tab.
 *
 * Not `=== activeTabId`. With splits every pane shows a tab simultaneously, so a pane's active tab
 * is visible even while another pane is focused — panels that measure themselves or refit a terminal
 * grid must react to this, not to workspace-wide activeness.
 */
export function useIsTabVisible(tabId: string): boolean {
  // Both selectors return primitives on purpose: a panel must not re-render every time some
  // unrelated tab's label changes or another pane is rearranged.
  const cwd = useTabStore((s) => tabVisibilityCwd(s.tabs, s.activeWorkspaceCwd, tabId));
  return useLayoutStore((s) => (cwd === null ? false : isPaneActiveTab(s.layouts[cwd], tabId)));
}

/** Non-hook counterpart of `useIsTabVisible`, same visibility rule, for callers outside React
 *  (`agent-ui-store.ts`'s effect routing needs a point-in-time answer when a `set_editor_text`
 *  effect arrives — sprint-069/task-007). */
export function isTabVisible(tabId: string): boolean {
  const { tabs, activeWorkspaceCwd } = useTabStore.getState();
  const cwd = tabVisibilityCwd(tabs, activeWorkspaceCwd, tabId);
  return cwd === null ? false : isPaneActiveTab(useLayoutStore.getState().layouts[cwd], tabId);
}

// ─── Tab id / open helpers (POC id conventions: "chat-<id>", "file-<path>", …) ────────────

export const tabIds = {
  chat: (sessionId: string) => `chat-${sessionId}`,
  file: (path: string) => `file-${path}`,
  diff: (path: string, staged: boolean) => `diff-${path}${staged ? "-staged" : ""}`,
  terminal: (slotOrToken: number | string) => `term-${slotOrToken}`,
  molecule: (key: string | number) => `mol-${key}`,
};

let terminalCount = 0;

/** Open a brand-new terminal tab against a workspace cwd (no slot yet — `TerminalPanel` creates
 * one on mount). Shared by the `Ctrl/Cmd+T` shortcut (`use-shortcuts.ts`) and the TabStrip's "+"
 * button so both paths mint tab ids/labels identically.
 *
 * `targetPaneId` places the tab in a named pane; omitted (the shortcut's case) it lands in the
 * focused pane. Same contract on `openNewMolecule`/`openNewChat` below. */
export function openNewTerminal(workspaceCwd: string, targetPaneId?: string): void {
  terminalCount += 1;
  useTabStore.getState().open(
    {
      id: tabIds.terminal(`new-${terminalCount}`),
      kind: "terminal",
      label: `Terminal ${terminalCount}`,
      closable: true,
      data: { slot: null, cwd: workspaceCwd },
      workspaceCwd,
    },
    targetPaneId,
  );
}

let moleculeCount = 0;

/** Open a brand-new empty molecule tab (no path — molviewer's own drag-drop empty state). Shared
 * by the "+" menu so it mints tab ids/labels identically wherever a future shortcut adds another
 * entry point. */
export function openNewMolecule(workspaceCwd: string, targetPaneId?: string): void {
  moleculeCount += 1;
  useTabStore.getState().open(
    {
      id: tabIds.molecule(`new-${moleculeCount}`),
      kind: "molecule",
      label: `Molecule ${moleculeCount}`,
      closable: true,
      data: { path: null },
      workspaceCwd,
    },
    targetPaneId,
  );
}

/** Open a brand-new chat: creates a session against a workspace cwd and opens/focuses its chat
 * tab. Shared by the sidebar's "+ New session" affordances (workspace context-menu item and
 * each workspace group's trailing row), `open-workspace.ts`'s create-new path, and the
 * TabStrip's "+" button — so every caller mints identical tab ids/labels (mirrors
 * `openNewTerminal` above). `workspaceCwd` MUST already be normalized by the caller (same
 * contract as `openNewTerminal`).
 *
 * Materializes eagerly: the tab and sidebar row appear synchronously from `createSession`/`open`
 * above, then `ensureMaterialized` (`materialize.ts`) commits a real, persisted `AgentRecord` in
 * the background — no spawn yet, just the record (`agent-service.ts` `handleCreate`'s
 * deferred-draft branch) — so every "New chat" has a bound `agentId` before the user does
 * anything. Best-effort: a failure here (or opening while disconnected, guarded by `if (client)`)
 * is retried by `Composer.submit`'s own `ensureMaterialized` call on the first send. */
export function openNewChat(workspaceCwd: string, targetPaneId?: string): void {
  const id = useSessionStore.getState().createSession(workspaceCwd);
  useTabStore.getState().open(
    {
      id: tabIds.chat(id),
      kind: "chat",
      label: "New chat",
      closable: true,
      data: { sessionId: id },
      workspaceCwd,
    },
    targetPaneId,
  );

  const client = useConnectionStore.getState().client;
  if (client) {
    void ensureMaterialized(client, id).catch(() => {
      // Best-effort: `Composer.submit`'s own `ensureMaterialized` retries on the first send.
    });
  }
}

/** Close a tab, discarding a never-used chat's draft record with it (`materialize.ts`
 * `discardIfEmpty`). Every UI close path MUST go through this, not `useTabStore.close` directly.
 */
export function closeTab(tabId: string): void {
  const tab = useTabStore.getState().tabs.find((t) => t.id === tabId);
  useTabStore.getState().close(tabId);
  if (tab?.kind !== "chat") return;
  const { sessionId } = tab.data as ChatTabData;
  void discardIfEmpty(useConnectionStore.getState().client, sessionId);
}

/**
 * `activeTabId` is a *projection* of layout state, so it has to follow **every** layout mutation — not
 * only the ones that originate in this store's own methods. Clicking into another pane calls
 * `layout-store.focusPane` directly (`TabStrip`'s and `TabPanelHost`'s `onPointerDown`), which changes
 * which tab is effectively active without touching this store at all; the same is true of any future
 * focus path (drag commit, keyboard pane navigation, a close fallback).
 *
 * Without this, focusing a second conversation left `activeTabId` — and through `syncActiveSession`,
 * `session-store.activeSessionId` — pointing at the previously focused pane's chat, so the status bar
 * kept showing the *old* conversation's model, context, tokens and cost while the user typed into a
 * different one. Making the projection genuinely derived is the only fix that also covers the next
 * caller who focuses a pane without going through here.
 *
 * Cheap enough to sit on every layout write, including a divider drag's per-frame mutations: it reads
 * one derived id and bails unless that id actually changed.
 */
useLayoutStore.subscribe(() => {
  const { activeWorkspaceCwd, activeTabId } = useTabStore.getState();
  if (activeWorkspaceCwd === null) return;
  if (useLayoutStore.getState().activeTabOf(activeWorkspaceCwd) === activeTabId) return;
  syncActiveSession(syncActiveFromLayout(activeWorkspaceCwd));
});
