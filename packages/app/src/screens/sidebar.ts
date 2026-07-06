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
  /** Friendly primary title shown as the row label (never an absolute path). */
  label: string;
  /** Absolute cwd — used for the tooltip only, never rendered as the label. */
  fullPath?: string;
  /** Grouping key (typically the cwd/project root). */
  projectKey?: string;
  /** Agent status, drives the status dot. */
  status?: string;
  provider?: string;
  model?: string;
  branch?: string;
  lastActivityMs?: number;
};

export type WorkspaceGroup = {
  key: string;
  label: string;
  rows: WorkspaceRow[];
};

// ---------------------------------------------------------------------------
// Label derivation (Paseo parity — never surface raw absolute paths)
// mirrors ~/DEV/paseo/packages/app/src/utils/project-display-name.ts
// ---------------------------------------------------------------------------

const GITHUB_REMOTE_PREFIX = "remote:github.com/";

/**
 * Friendly project/section name from a project key (cwd or remote id):
 * - `remote:github.com/owner/repo` → `owner/repo`
 * - `/home/me/DEV/edenred` → `edenred` (trailing directory)
 * - `~` or `/` → returned as-is
 * - empty/undefined → `Ungrouped`
 */
export function projectDisplayName(projectKey: string | undefined): string {
  const key = projectKey?.trim();
  if (!key || key === "ungrouped") return "Ungrouped";
  if (key.startsWith(GITHUB_REMOTE_PREFIX)) return key.slice(GITHUB_REMOTE_PREFIX.length) || key;
  if (key === "~" || key === "/") return key;
  const segments = key.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || key;
}

/** Home-relative pretty path for tooltips: `/home/x/DEV/y` → `~/DEV/y`. */
export function prettyPath(cwd: string | undefined): string {
  if (!cwd) return "";
  return cwd.replace(/^\/(?:home|Users)\/[^/]+/, "~");
}

/**
 * Friendly workspace-row label: agent title, else branch, else the project
 * (trailing dir) name, else a short session id. Never an absolute path.
 */
export function deriveWorkspaceLabel(input: {
  title?: string | null;
  cwd?: string;
  branch?: string | null;
  agentId: string;
}): string {
  const title = input.title?.trim();
  if (title) return title;
  const branch = input.branch?.trim();
  if (branch) return branch;
  const proj = projectDisplayName(input.cwd);
  if (proj && proj !== "Ungrouped") return proj;
  return `Session ${input.agentId.slice(0, 6)}`;
}

/** Compact secondary metadata line for a row (model / provider), or "". */
export function workspaceRowSubtitle(row: Pick<WorkspaceRow, "model" | "provider">): string {
  return row.model?.trim() || row.provider?.trim() || "";
}

export function groupWorkspaces(rows: readonly WorkspaceRow[], mode: "project" | "recent"): WorkspaceGroup[] {
  if (mode === "recent") {
    return [{ key: "recent", label: "Recent", rows: [...rows].sort((a, b) => (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0)) }];
  }
  // Preserve first-seen group order for a stable layout.
  const map = new Map<string, WorkspaceRow[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = row.projectKey ?? "ungrouped";
    if (!map.has(key)) order.push(key);
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return order.map((key) => ({
    key,
    label: projectDisplayName(key === "ungrouped" ? undefined : key),
    rows: map.get(key) ?? [],
  }));
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
