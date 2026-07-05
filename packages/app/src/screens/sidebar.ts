// Global left sidebar shell helpers.
// app-navigation-screens.md § Global navigation shell

import type { HostRuntimeSnapshot } from "../runtime/host-runtime.js";
import { activeHostForPath, shouldShowSidebar, translateRouteToHost } from "../runtime/app-shell.js";

export type SidebarMode = "hidden" | "pinned" | "overlay";

export function sidebarMode(input: {
  path: string;
  storeReady: boolean;
  hosts: readonly HostRuntimeSnapshot[];
  isCompact: boolean;
  focusMode: boolean;
}): SidebarMode {
  if (!shouldShowSidebar(input.path, input.storeReady, input.hosts)) return "hidden";
  if (input.focusMode) return "hidden";
  return input.isCompact ? "overlay" : "pinned";
}

export function shouldStartEdgeSwipe(input: {
  x: number;
  dx: number;
  dy: number;
  isCompact: boolean;
}): boolean {
  if (!input.isCompact) return false;
  if (input.x > 32) return false;
  if (Math.abs(input.dy) > Math.abs(input.dx)) return false;
  return input.dx > 8;
}

export type WorkspaceRow = {
  workspaceId: string;
  label: string;
  projectKey?: string;
  lastActivityMs?: number;
};

export type WorkspaceGroup = {
  key: string;
  label: string;
  rows: WorkspaceRow[];
};

export function groupWorkspaces(rows: readonly WorkspaceRow[], mode: "project" | "recent"): WorkspaceGroup[] {
  if (mode === "recent") {
    return [{ key: "recent", label: "Recent", rows: [...rows].sort((a, b) => (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0)) }];
  }
  const map = new Map<string, WorkspaceRow[]>();
  for (const row of rows) {
    const key = row.projectKey ?? "ungrouped";
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return [...map.entries()].map(([key, groupRows]) => ({ key, label: key === "ungrouped" ? "Ungrouped" : key, rows: groupRows }));
}

export type SidebarFooterAction = "add-project" | "home" | "settings" | "host-switcher" | "new-workspace";

export const SIDEBAR_FOOTER_ACTIONS: readonly SidebarFooterAction[] = [
  "add-project",
  "home",
  "settings",
  "host-switcher",
  "new-workspace",
];

export { activeHostForPath, translateRouteToHost };
