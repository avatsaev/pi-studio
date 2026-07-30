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
 * `lastActiveTabByWorkspace` remembers each workspace's last-focused tab so switching back to a
 * workspace restores exactly where you left it, not always its first tab.
 */

import { create } from "zustand";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { ensureMaterialized, discardIfEmpty } from "@pi-studio-ui/stores/materialize.js";

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
  activeTabId: string | null;
  /** Which workspace's tabs are currently visible in the strip/panel host. */
  activeWorkspaceCwd: string | null;
  /** Last-focused tab id per workspace cwd, for restore-on-switch. */
  lastActiveTabByWorkspace: Record<string, string>;

  /** Open a tab, or activate it if a tab with the same `id` already exists (POC `addTab`).
   * Always brings the tab's workspace into view. */
  open(tab: Tab): void;
  close(id: string): void;
  /** Activate a tab by id, bringing its workspace into view too. */
  activate(id: string): void;
  /** Switch the visible workspace, restoring its last-focused tab (or its first tab, or none). */
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
  lastActiveTabByWorkspace: {},

  open(tab) {
    const existing = get().tabs.find((t) => t.id === tab.id);
    if (existing) {
      get().activate(existing.id);
      return;
    }
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      activeWorkspaceCwd: tab.workspaceCwd,
      lastActiveTabByWorkspace: { ...s.lastActiveTabByWorkspace, [tab.workspaceCwd]: tab.id },
    }));
    syncActiveSession(tab);
  },

  close(id) {
    let fallbackTab: Tab | undefined;
    set((s) => {
      const closed = s.tabs.find((t) => t.id === id);
      if (!closed) return s;
      const idx = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);

      let activeTabId = s.activeTabId;
      const lastActiveTabByWorkspace = { ...s.lastActiveTabByWorkspace };
      if (activeTabId === id) {
        // Fall back to a sibling within the SAME workspace, not the global next tab — closing a
        // tab must never jump the visible workspace out from under the user.
        const siblings = tabsInWorkspace(tabs, closed.workspaceCwd);
        const siblingIdx = Math.min(idx, siblings.length - 1);
        const next = siblings[siblingIdx];
        activeTabId = next?.id ?? null;
        fallbackTab = next;
      }
      if (lastActiveTabByWorkspace[closed.workspaceCwd] === id) {
        const stillOpen = tabsInWorkspace(tabs, closed.workspaceCwd)[0];
        if (stillOpen) lastActiveTabByWorkspace[closed.workspaceCwd] = stillOpen.id;
        else delete lastActiveTabByWorkspace[closed.workspaceCwd];
      }
      return { tabs, activeTabId, lastActiveTabByWorkspace };
    });
    syncActiveSession(fallbackTab);
  },

  activate(id) {
    let activatedTab: Tab | undefined;
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab) return s;
      activatedTab = tab;
      return {
        activeTabId: id,
        activeWorkspaceCwd: tab.workspaceCwd,
        lastActiveTabByWorkspace: { ...s.lastActiveTabByWorkspace, [tab.workspaceCwd]: id },
      };
    });
    syncActiveSession(activatedTab);
  },

  switchWorkspace(cwd) {
    let switchedTab: Tab | undefined;
    set((s) => {
      const siblings = tabsInWorkspace(s.tabs, cwd);
      const remembered = s.lastActiveTabByWorkspace[cwd];
      const stillOpen = remembered && siblings.some((t) => t.id === remembered);
      const activeTabId = stillOpen ? remembered : (siblings[0]?.id ?? null);
      switchedTab = siblings.find((t) => t.id === activeTabId);
      return {
        activeWorkspaceCwd: cwd,
        activeTabId,
        lastActiveTabByWorkspace: activeTabId
          ? { ...s.lastActiveTabByWorkspace, [cwd]: activeTabId }
          : s.lastActiveTabByWorkspace,
      };
    });
    syncActiveSession(switchedTab);
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
 * button so both paths mint tab ids/labels identically. */
export function openNewTerminal(workspaceCwd: string): void {
  terminalCount += 1;
  useTabStore.getState().open({
    id: tabIds.terminal(`new-${terminalCount}`),
    kind: "terminal",
    label: `Terminal ${terminalCount}`,
    closable: true,
    data: { slot: null, cwd: workspaceCwd },
    workspaceCwd,
  });
}

let moleculeCount = 0;

/** Open a brand-new empty molecule tab (no path — molviewer's own drag-drop empty state). Shared
 * by the "+" menu so it mints tab ids/labels identically wherever a future shortcut adds another
 * entry point. */
export function openNewMolecule(workspaceCwd: string): void {
  moleculeCount += 1;
  useTabStore.getState().open({
    id: tabIds.molecule(`new-${moleculeCount}`),
    kind: "molecule",
    label: `Molecule ${moleculeCount}`,
    closable: true,
    data: { path: null },
    workspaceCwd,
  });
}

/** Open a brand-new chat: creates a session against a workspace cwd and opens/focuses its chat
 * tab. Shared by the sidebar's "+ New conversation" button, `open-workspace.ts`'s create-new
 * path, and the TabStrip's "+" button — so every caller mints identical tab ids/labels (mirrors
 * `openNewTerminal` above). `workspaceCwd` MUST already be normalized by the caller (same
 * contract as `openNewTerminal`).
 *
 * Materializes eagerly: the tab and sidebar row appear synchronously from `createSession`/`open`
 * above, then `ensureMaterialized` (`materialize.ts`) commits a real, persisted `AgentRecord` in
 * the background — no spawn yet, just the record (`agent-service.ts` `handleCreate`'s
 * deferred-draft branch) — so every "New chat" has a bound `agentId` before the user does
 * anything. Best-effort: a failure here (or opening while disconnected, guarded by `if (client)`)
 * is retried by `Composer.submit`'s own `ensureMaterialized` call on the first send. */
export function openNewChat(workspaceCwd: string): void {
  const id = useSessionStore.getState().createSession(workspaceCwd);
  useTabStore.getState().open({
    id: tabIds.chat(id),
    kind: "chat",
    label: "New chat",
    closable: true,
    data: { sessionId: id },
    workspaceCwd,
  });

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
