/**
 * Groups sidebar sessions by workspace (cwd) — each workspace is a project folder that can host
 * several chat sessions, nested under a collapsible header (POC_TO_APP_PLAN_UI.md §4.3 follow-up:
 * workspace-tree sidebar).
 */

import type { SessionEntry } from "../../stores/session-store.js";

export interface WorkspaceGroup {
  /** Normalized (tilde-expanded when known) cwd — the group identity and RPC-ready path. */
  cwd: string;
  sessions: SessionEntry[];
}

/** Expand a leading `~` against `homeDir` when known; otherwise return `path` unchanged. Single
 * source of truth for workspace identity — every consumer that needs to compare/derive a
 * workspace cwd (grouping, tab scoping, the open-workspace resolver) MUST go through this, or a
 * second normalization drifting from this one reintroduces tilde/absolute duplicate workspaces. */
export function normalizeCwd(path: string, homeDir: string | null): string {
  if (homeDir && (path === "~" || path.startsWith("~/"))) return homeDir + path.slice(1);
  return path;
}

/**
 * Buckets sessions by `cwd` (tilde-normalized against `homeDir` so `~/proj` and
 * `/home/user/proj` merge into one workspace once the home dir is known), preserving `order`'s
 * recency: a workspace's position is its first appearance in `order`, and sessions within it keep
 * their relative `order` position too — so the most recently created/active session in each
 * workspace sorts first.
 */
export function groupSessionsByWorkspace(
  order: string[],
  sessions: Record<string, SessionEntry>,
  homeDir: string | null,
): WorkspaceGroup[] {
  const groups = new Map<string, SessionEntry[]>();
  for (const id of order) {
    const session = sessions[id];
    if (!session) continue;
    const cwd = normalizeCwd(session.cwd || "~", homeDir);
    const bucket = groups.get(cwd);
    if (bucket) bucket.push(session);
    else groups.set(cwd, [session]);
  }
  return Array.from(groups, ([cwd, sessionsInGroup]) => ({ cwd, sessions: sessionsInGroup }));
}

/** Short display label for a workspace path — the last path segment, or `~` for the home dir. */
export function workspaceLabel(cwd: string): string {
  if (!cwd || cwd === "~") return "~";
  return cwd.split("/").filter(Boolean).pop() || cwd;
}
