/**
 * Turns a `SessionEntry` into the sidebar's row presentation (state kind, meta text, optional
 * short failure reason, `StatusDot` input, italic-title flag) and a workspace's sessions into the
 * collapsed band's attention dot. Pure — no React, no store access — so it is unit-testable in
 * isolation (design spec § 03, § 02, § 07).
 */

import type { SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import type { StatusDotInput } from "@pi-studio-ui/ui/status-dot.js";
import { toDotStatus } from "./status-map.js";

export type SidebarSessionState = "running" | "failed" | "empty" | "idle" | "needsInput";

export interface SidebarSessionView {
  state: SidebarSessionState;
  /** Meta-line label: "running" | "turn failed" | "no messages" | "idle". */
  meta: string;
  /** Second meta segment — the failure reason. Non-null only when state === "failed". */
  reason: string | null;
  /** `StatusDot` props for the meta row — every state gets one (a muted flat dot for idle/empty,
   * a spinner for running, a danger dot for failed) so the row always carries a colored status
   * signal, not only running/failed. */
  dot: StatusDotInput | null;
  /** True for a never-used session — § 03 renders its title italic. */
  titleItalic: boolean;
}

const REASON_MAX_LENGTH = 120;

function sidebarState(session: SessionEntry, hasPendingQuestion: boolean): SidebarSessionState {
  if (session.status === "error") return "failed";
  // Needs-input takes the slot from a running spinner while a question is pending (§ 08) — checked
  // before "running" so a running session with a pending question reads as needs-input, not busy.
  if (hasPendingQuestion) return "needsInput";
  if (session.status === "running") return "running";
  if (session.userMessageCount === 0 && session.timeline.rows.length === 0) return "empty";
  // `initializing` and `closed` fold into idle — a permanently green "finished" dot on every
  // closed session is decoration, not status (same call sprint-061/task-004 made for tab dots).
  return "idle";
}

/** Last `kind === "error"` timeline row's text, single-line, trimmed, capped — or null if the
 * session has no error row (possible after a reload hydrates status without history). */
function lastErrorReason(session: SessionEntry): string | null {
  const { rows } = session.timeline;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row && row.kind === "error") {
      const firstLine = (row.text.split("\n", 1)[0] ?? "").trim();
      return firstLine.length > REASON_MAX_LENGTH
        ? firstLine.slice(0, REASON_MAX_LENGTH)
        : firstLine;
    }
  }
  return null;
}

/**
 * @param hasPendingQuestion Whether at least one extension question is pending on this session
 *   (sprint-068's store — sourced by the caller; this module stays store-free). One or many
 *   pending questions render the same single signal (§ 08: "one signal per row").
 */
export function sidebarSessionView(
  session: SessionEntry,
  hasPendingQuestion: boolean,
): SidebarSessionView {
  const state = sidebarState(session, hasPendingQuestion);

  switch (state) {
    case "failed":
      return {
        state,
        meta: "turn failed",
        reason: lastErrorReason(session),
        dot: { status: toDotStatus("error") },
        titleItalic: false,
      };
    case "needsInput":
      return {
        state,
        meta: "needs input",
        reason: null,
        // `requiresAttention`/`attentionReason: "question"` overrides the dot color to
        // `statusWarning` regardless of `status` (status-dot.ts) — including suppressing the
        // running spinner (`StatusDot.tsx`'s `spinning` check), which is how a running session
        // with a pending question loses its spinner in favor of the flat warning dot.
        dot: {
          status: toDotStatus(session.status),
          requiresAttention: true,
          attentionReason: "question",
        },
        titleItalic: false,
      };
    case "running":
      return {
        state,
        meta: "running",
        reason: null,
        dot: { status: toDotStatus("running") },
        titleItalic: false,
      };
    case "empty":
      return {
        state,
        meta: "no messages",
        reason: null,
        dot: { status: toDotStatus("idle"), showInactive: true },
        titleItalic: true,
      };
    case "idle":
      return {
        state,
        meta: "idle",
        reason: null,
        dot: { status: toDotStatus("idle"), showInactive: true },
        titleItalic: false,
      };
  }
}

export interface WorkspaceAttentionInfo {
  dot: StatusDotInput;
  /** Precedence decision (sprint-069/task-003): a pending question wins over a failed session —
   * a failed turn is already over and can be reviewed whenever, while a pending question means an
   * agent is actively blocked on the user right now, the more urgent state to surface in a
   * collapsed group's single dot. */
  reason: "question" | "failed";
  /** Number of *sessions* (not questions) with a pending question — only meaningful when
   * `reason === "question"`; § 08's accessible-name count is per-session, and one session with
   * two pending questions still counts once (task-001's "one signal per row" extended to the
   * group level). */
  pendingSessionCount: number;
}

/** Collapsed workspace band: a dot only when a child needs attention, else null. Running is
 * deliberately not attention (§ 03: dot shows "when collapsed and a child needs attention").
 * `pendingAgentIds` is sprint-068's store, aggregated by the caller (`useAgentUiPendingAgentIds`)
 * — this module stays store-free, matching `sidebarSessionView`'s contract. */
export function workspaceAttentionDot(
  sessions: SessionEntry[],
  pendingAgentIds: ReadonlySet<string>,
): WorkspaceAttentionInfo | null {
  const pendingSessionCount = sessions.filter(
    (session) => session.agentId !== null && pendingAgentIds.has(session.agentId),
  ).length;
  if (pendingSessionCount > 0) {
    return {
      dot: { status: "waiting", requiresAttention: true, attentionReason: "question" },
      reason: "question",
      pendingSessionCount,
    };
  }
  const hasFailed = sessions.some((session) => session.status === "error");
  if (hasFailed) {
    return { dot: { status: toDotStatus("error") }, reason: "failed", pendingSessionCount: 0 };
  }
  return null;
}
