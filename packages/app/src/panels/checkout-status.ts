// Checkout status badge, stale-branch detection, and git notifications — pure
// models. Wired to `checkout_status_update` subscriptions + toasts by hooks.
//
// clean-room-scope/features/git-checkout.md § checkout status
// clean-room-scope/features/worktrees.md
// clean-room-scope/features/workspace-ui.md § header controls

import type { GitStatusSummary } from "./git-controls.js";

// ─── Checkout status badge ───────────────────────────────────────────────────

export type CheckoutState = "clean" | "dirty" | "ahead" | "behind" | "diverged";

export interface CheckoutBadge {
  branch: string;
  state: CheckoutState;
  /** Icon token consumed by the component (checkmark/dot/arrow/etc.). */
  icon: "check" | "dot" | "up" | "down" | "up-down";
  /** Short label, e.g. "main", "main ↑2", "main ↕1↓3". */
  label: string;
  aheadCount: number;
  behindCount: number;
  tone: "neutral" | "warning" | "success";
}

export function deriveCheckoutState(status: GitStatusSummary): CheckoutState {
  const ahead = status.aheadCount ?? 0;
  const behind = status.behindCount ?? 0;
  if (ahead > 0 && behind > 0) return "diverged";
  if (status.isDirty) return "dirty";
  if (ahead > 0) return "ahead";
  if (behind > 0) return "behind";
  return "clean";
}

export function deriveCheckoutBadge(status: GitStatusSummary): CheckoutBadge {
  const branch = status.branch ?? "(no branch)";
  const ahead = status.aheadCount ?? 0;
  const behind = status.behindCount ?? 0;
  const state = deriveCheckoutState(status);

  let icon: CheckoutBadge["icon"];
  let tone: CheckoutBadge["tone"] = "neutral";
  switch (state) {
    case "clean": icon = "check"; tone = "success"; break;
    case "dirty": icon = "dot"; tone = "warning"; break;
    case "ahead": icon = "up"; break;
    case "behind": icon = "down"; break;
    case "diverged": icon = "up-down"; tone = "warning"; break;
  }

  return { branch, state, icon, label: badgeLabel(branch, ahead, behind, state), aheadCount: ahead, behindCount: behind, tone };
}

function badgeLabel(branch: string, ahead: number, behind: number, state: CheckoutState): string {
  const parts: string[] = [];
  if (ahead > 0) parts.push(`↑${ahead}`);
  if (behind > 0) parts.push(`↓${behind}`);
  if (state === "dirty") parts.push("•");
  return parts.length > 0 ? `${branch} ${parts.join("")}` : branch;
}

// ─── Stale-branch indicator ──────────────────────────────────────────────────

export const STALE_BRANCH_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A branch is stale when it is behind upstream and its last upstream sync was
 * more than `days` ago.
 */
export function isStaleBranch(
  status: GitStatusSummary & { lastUpstreamSyncMs?: number },
  now: number,
  days = STALE_BRANCH_DAYS,
): boolean {
  if ((status.behindCount ?? 0) <= 0) return false;
  if (status.lastUpstreamSyncMs == null) return false;
  return now - status.lastUpstreamSyncMs > days * DAY_MS;
}

// ─── Git notifications ───────────────────────────────────────────────────────

export type GitNotificationEvent =
  | { type: "push_success"; count: number; branch: string }
  | { type: "pull_new"; count: number }
  | { type: "conflict"; files: string[] }
  | { type: "worktree_created"; path: string };

export type GitNotificationTone = "success" | "info" | "error";

export interface GitNotification {
  tone: GitNotificationTone;
  title: string;
  /** Optional action affordance (e.g. open the Changes tab). */
  action?: { label: string; target: string };
}

export function buildGitNotification(event: GitNotificationEvent): GitNotification {
  switch (event.type) {
    case "push_success":
      return {
        tone: "success",
        title: `Pushed ${event.count} commit${event.count === 1 ? "" : "s"} to origin/${event.branch}`,
      };
    case "pull_new":
      return { tone: "info", title: `Pulled ${event.count} new commit${event.count === 1 ? "" : "s"}` };
    case "conflict":
      return {
        tone: "error",
        title: `Merge conflict in ${event.files.length} file${event.files.length === 1 ? "" : "s"}`,
        action: { label: "View changes", target: "changes" },
      };
    case "worktree_created":
      return { tone: "success", title: `Worktree created at ${event.path}` };
  }
}
