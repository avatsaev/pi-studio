/**
 * UI store — ephemeral, session-independent UI state that doesn't belong to any single agent
 * session: the toolbar's connection fields, overlay visibility (workspace-open dialog, session
 * context menu), and `cwd` — the default cwd for a brand-new bare session and the initial path
 * of `OpenWorkspaceDialog` when no workspace is in view. NOT the "current browsing
 * scope" — that's `tab-store.ts`'s `activeWorkspaceCwd`, driven by whichever tab is in view
 * (§4.7 follow-up: workspace-scoped tabs). Sidebar visibility/width (collapsed flags, resizable
 * widths dragged via `ResizeHandle`) also live here. Mirrors POC globals `$("host")`,
 * `$("password")`, `$("chat-cwd")`, `cwdPickerPath`, `menuTargetSessionId`.
 */

import { create } from "zustand";

export const MIN_SIDEBAR_WIDTH = 100;
export const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_LEFT_SIDEBAR_WIDTH = 220;
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 280;

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

export interface UiStoreState {
  host: string;
  password: string;
  cwd: string;

  cwdPickerOpen: boolean;
  /** Settings dialog (gear at the ConnectionBar's top-right, sprint-065). */
  settingsOpen: boolean;
  sessionMenu: { sessionId: string; x: number; y: number } | null;
  /** Per-workspace "⋮" menu (sidebar workspace header — New session / Delete workspace). */
  workspaceMenu: { cwd: string; x: number; y: number } | null;
  /** Per-tab "right-click → Close" menu (sprint-069/task-004 — the minimal escape hatch for
   * closing a tab whose `×` the tight-strip rule has replaced with an attention dot). */
  tabMenu: { tabId: string; x: number; y: number } | null;
  /** `background: true` is the empty-space variant (right-click below the last row, or a
   * selected directory's "New File"/"New Folder") — `path` is the target directory, not a
   * specific row; the menu renders New File/New Folder/Copy Path only, no Open/Download/Delete. */
  fileMenu: {
    path: string;
    isDirectory: boolean;
    x: number;
    y: number;
    background?: boolean;
  } | null;
  rightSidebarTab: "files" | "changes";
  /** Workspace cwds collapsed in the sidebar tree (§4.3 workspace grouping); expanded by default. */
  collapsedWorkspaces: Set<string>;
  /** Left (sessions tree) / right (Files·Changes) sidebar visibility; both expanded by default. */
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  /** User-resizable sidebar widths in px, draggable via `ResizeHandle` — clamped to [MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH]. */
  leftSidebarWidth: number;
  rightSidebarWidth: number;

  setHost(host: string): void;
  setPassword(password: string): void;
  setCwd(cwd: string): void;
  openCwdPicker(): void;
  closeCwdPicker(): void;
  openSettings(): void;
  closeSettings(): void;
  openSessionMenu(sessionId: string, x: number, y: number): void;
  closeSessionMenu(): void;
  openWorkspaceMenu(cwd: string, x: number, y: number): void;
  closeWorkspaceMenu(): void;
  openTabMenu(tabId: string, x: number, y: number): void;
  closeTabMenu(): void;
  openFileMenu(
    path: string,
    isDirectory: boolean,
    x: number,
    y: number,
    background?: boolean,
  ): void;
  closeFileMenu(): void;
  setRightSidebarTab(tab: "files" | "changes"): void;
  toggleWorkspaceCollapsed(cwd: string): void;
  setCollapsedWorkspaces(cwds: Set<string>): void;
  toggleLeftSidebar(): void;
  toggleRightSidebar(): void;
  setLeftSidebarWidth(width: number): void;
  setRightSidebarWidth(width: number): void;
  /** Delta-based resize, reading current width from store state — avoids stale-closure drift
   * across the rapid-fire `pointermove` deltas `ResizeHandle` reports. */
  resizeLeftSidebar(deltaX: number): void;
  resizeRightSidebar(deltaX: number): void;
}

export const useUiStore = create<UiStoreState>()((set) => ({
  host: "ws://127.0.0.1:6767",
  password: "",
  cwd: "~",

  cwdPickerOpen: false,
  settingsOpen: false,
  sessionMenu: null,
  workspaceMenu: null,
  tabMenu: null,
  fileMenu: null,
  rightSidebarTab: "files",
  collapsedWorkspaces: new Set(),
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: false,
  leftSidebarWidth: DEFAULT_LEFT_SIDEBAR_WIDTH,
  rightSidebarWidth: DEFAULT_RIGHT_SIDEBAR_WIDTH,

  setHost: (host) => set({ host }),
  setPassword: (password) => set({ password }),
  setCwd: (cwd) => set({ cwd }),
  openCwdPicker: () => set({ cwdPickerOpen: true }),
  closeCwdPicker: () => set({ cwdPickerOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openSessionMenu: (sessionId, x, y) => set({ sessionMenu: { sessionId, x, y } }),
  closeSessionMenu: () => set({ sessionMenu: null }),
  openWorkspaceMenu: (cwd, x, y) => set({ workspaceMenu: { cwd, x, y } }),
  closeWorkspaceMenu: () => set({ workspaceMenu: null }),
  openTabMenu: (tabId, x, y) => set({ tabMenu: { tabId, x, y } }),
  closeTabMenu: () => set({ tabMenu: null }),
  openFileMenu: (path, isDirectory, x, y, background) =>
    set({ fileMenu: { path, isDirectory, x, y, background } }),
  closeFileMenu: () => set({ fileMenu: null }),
  setRightSidebarTab: (tab) => set({ rightSidebarTab: tab }),
  toggleWorkspaceCollapsed: (cwd) =>
    set((s) => {
      const next = new Set(s.collapsedWorkspaces);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return { collapsedWorkspaces: next };
    }),
  setCollapsedWorkspaces: (cwds) => set({ collapsedWorkspaces: cwds }),
  toggleLeftSidebar: () => set((s) => ({ leftSidebarCollapsed: !s.leftSidebarCollapsed })),
  toggleRightSidebar: () => set((s) => ({ rightSidebarCollapsed: !s.rightSidebarCollapsed })),
  setLeftSidebarWidth: (width) => set({ leftSidebarWidth: clampSidebarWidth(width) }),
  setRightSidebarWidth: (width) => set({ rightSidebarWidth: clampSidebarWidth(width) }),
  resizeLeftSidebar: (deltaX) =>
    set((s) => ({ leftSidebarWidth: clampSidebarWidth(s.leftSidebarWidth + deltaX) })),
  resizeRightSidebar: (deltaX) =>
    set((s) => ({ rightSidebarWidth: clampSidebarWidth(s.rightSidebarWidth + deltaX) })),
}));
