// AgentStatusDot — state-bucket → color mapping.
// ui-components.md § Status dots & avatars

// Agent status strings that the daemon can send (from agent-sessions.md).
export type AgentStatus =
  | "idle"
  | "running"
  | "waiting"
  | "finished"
  | "error"
  | "queued"
  | "archived";

export type AttentionReason = "finished" | "error" | "permission";

export type StatusDotInput = {
  status: AgentStatus | undefined | null;
  requiresAttention?: boolean;
  attentionReason?: AttentionReason;
  pendingPermissionCount?: number;
  showInactive?: boolean;
};

export type StatusDotColor =
  | "accent"         // running/active
  | "statusSuccess"  // finished-ok / success
  | "statusDanger"   // error / attention
  | "statusWarning"  // waiting / pending permission
  | "foregroundMuted"; // idle / inactive

/**
 * Returns the theme token key for the status dot color, or null if the dot
 * should not be rendered (missing/invalid status and showInactive=false).
 */
export function statusDotColor(input: StatusDotInput): StatusDotColor | null {
  const { status, requiresAttention, attentionReason, showInactive } = input;

  if (!status) return null;

  // Attention overrides the base status color.
  if (requiresAttention) {
    switch (attentionReason) {
      case "permission":
        return "statusWarning";
      case "error":
        return "statusDanger";
      case "finished":
      default:
        return "statusSuccess";
    }
  }

  switch (status) {
    case "running":
    case "queued":
      return "accent";
    case "waiting":
      return "statusWarning";
    case "finished":
      return "statusSuccess";
    case "error":
      return "statusDanger";
    case "idle":
    case "archived":
      return showInactive ? "foregroundMuted" : null;
  }
}

// Status dot dimensions per the spec (8×8 round).
export const STATUS_DOT_SIZE = 8;
