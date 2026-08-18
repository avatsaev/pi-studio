/**
 * Turns a `SessionEntry` into the sidebar's row presentation (state kind, meta text, optional
 * short failure reason, `StatusDot` input, italic-title flag) and a workspace's sessions into the
 * collapsed band's attention dot. Pure — no React, no store access — so it is unit-testable in
 * isolation (design spec § 03, § 02, § 07).
 */

import type { SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import type { StatusDotInput } from "@pi-studio-ui/ui/status-dot.js";
import { toDotStatus } from "./status-map.js";

export type SidebarSessionState = "running" | "failed" | "empty" | "idle";

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

function sidebarState(session: SessionEntry): SidebarSessionState {
  if (session.status === "error") return "failed";
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

export function sidebarSessionView(session: SessionEntry): SidebarSessionView {
  const state = sidebarState(session);

  switch (state) {
    case "failed":
      return {
        state,
        meta: "turn failed",
        reason: lastErrorReason(session),
        dot: { status: toDotStatus("error") },
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

/** Collapsed workspace band: a dot only when a child needs attention, else null. Running is
 * deliberately not attention (§ 03: dot shows "when collapsed and a child needs attention"); with
 * needs-input unsourceable in this client, `error` is the only real attention signal available. */
export function workspaceAttentionDot(sessions: SessionEntry[]): StatusDotInput | null {
  const hasFailed = sessions.some((session) => session.status === "error");
  return hasFailed ? { status: toDotStatus("error") } : null;
}
