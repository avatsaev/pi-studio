/**
 * CheckoutStatusBadge — branch + status icon in the workspace header.
 * WorktreeCallout — worktree banner with switch/delete actions.
 *
 * git-checkout.md § checkout status; worktrees.md; workspace-ui.md § header
 */

import { Check, Circle, ArrowUp, ArrowDown, ChevronsUpDown, AlertTriangle, GitBranch } from "lucide-react";
import { clsx } from "clsx";
import styles from "./CheckoutStatusBadge.module.css";
import type { CheckoutBadge } from "../../panels/checkout-status.js";
import { buildWorktreeCallout, type GitStatusSummary } from "../../panels/git-controls.js";

export interface CheckoutStatusBadgeProps {
  badge: CheckoutBadge;
  stale?: boolean;
  onClick?: () => void;
}

const ICONS = {
  check: Check,
  dot: Circle,
  up: ArrowUp,
  down: ArrowDown,
  "up-down": ChevronsUpDown,
} as const;

export function CheckoutStatusBadge({ badge, stale = false, onClick }: CheckoutStatusBadgeProps) {
  const Icon = ICONS[badge.icon];
  return (
    <button
      className={clsx(styles.badge, styles[`tone_${badge.tone}`])}
      onClick={onClick}
      title={`${badge.branch} — ${badge.state}${stale ? " (stale)" : ""}`}
    >
      <Icon size={12} className={badge.icon === "dot" ? styles.dotFill : undefined} />
      <span className={styles.label}>{badge.label}</span>
      {stale && <AlertTriangle size={11} className={styles.staleIcon} />}
    </button>
  );
}

// ─── Worktree callout ────────────────────────────────────────────────────────

export interface WorktreeCalloutProps {
  status: GitStatusSummary;
  onSwitchToMain?: () => void;
  onDeleteWorktree?: () => void;
}

export function WorktreeCallout({ status, onSwitchToMain, onDeleteWorktree }: WorktreeCalloutProps) {
  const callout = buildWorktreeCallout(status);
  if (!callout.visible) return null;

  return (
    <div className={styles.callout}>
      <GitBranch size={14} />
      <span className={styles.calloutMsg}>{callout.message}</span>
      <div className={styles.calloutActions}>
        {onSwitchToMain && (
          <button className={styles.calloutBtn} onClick={onSwitchToMain}>
            Switch to main
          </button>
        )}
        {onDeleteWorktree && (
          <button className={clsx(styles.calloutBtn, styles.calloutDanger)} onClick={onDeleteWorktree}>
            Delete worktree
          </button>
        )}
      </div>
    </div>
  );
}
