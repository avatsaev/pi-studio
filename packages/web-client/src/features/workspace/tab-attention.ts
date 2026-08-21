/**
 * A background chat tab's "attention" state — a projection of its session's status, never new
 * per-tab state. `Tab` has no unread/dirty flag (`stores/tab-store.ts`), and inventing one means
 * owning read-receipt semantics (what marks a tab read? focus? scroll to bottom?) that redesign
 * spec § 07 does not define and nothing else in the app tracks.
 *
 * Only two statuses earn a dot from `sessionStatus` alone: a turn in progress, or the last one
 * having failed. Every other status (`idle`, `initializing`, `closed`) would paint permanent
 * decoration rather than attention — a `closed` session's tab does not need a green dot forever.
 * Sprint-069/task-004 adds a third, independent source: a pending extension question, sourced
 * from sprint-068's store rather than `sessionStatus` (the two are orthogonal — a session can be
 * `idle` with a question pending). The pane's own *active* chat tab never gets a dot at all, for
 * any source: `TurnProgressBar` already sweeps under the strip while a turn runs, an `ErrorRow`
 * already renders a failed turn in the timeline, and sprint-068's own cards already render inline
 * for the active session — a dot directly above any of those would be the same information
 * twice. This is strictly the background-tab affordance.
 *
 * swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html § 07
 */

import type { AgentStatus as ProtocolAgentStatus } from "@av-pi-studio/protocol";
import type { StatusDotInput } from "@pi-studio-ui/ui/status-dot.js";
import { toDotStatus } from "@pi-studio-ui/features/sessions/status-map.js";
import type { Tab } from "@pi-studio-ui/stores/tab-store.js";

/**
 * `sessionStatus` is `undefined` for a chat tab whose session hasn't landed in the store yet (an
 * offline-restore ordering gap) — treated the same as "nothing to show", never a throw.
 * `activeInPane` is whether `tab` is its own pane's active tab (not workspace-active — the same
 * per-pane notion `TabStrip.tsx` already highlights). `hasPendingQuestion` is sprint-068's store,
 * sourced by the caller (`useAgentUiPending`) — this module stays store-free, matching
 * `sidebarSessionView`'s contract (sprint-069/task-001). Needs-input does not depend on
 * `sessionStatus` at all (it is a distinct, session-status-independent signal), so it is checked
 * before the `sessionStatus === undefined` gap — an offline-restore ordering gap on the *session*
 * store must not suppress a pending-question signal that already landed via the *agent-ui* store.
 */
export function tabAttentionStatus(
  tab: Tab,
  sessionStatus: ProtocolAgentStatus | "idle" | undefined,
  activeInPane: boolean,
  hasPendingQuestion: boolean,
): StatusDotInput | null {
  if (tab.kind !== "chat" || activeInPane) return null;
  if (hasPendingQuestion) {
    return { status: "waiting", requiresAttention: true, attentionReason: "question" };
  }
  if (sessionStatus === undefined) return null;
  const dotStatus = toDotStatus(sessionStatus);
  return dotStatus === "running" || dotStatus === "error" ? { status: dotStatus } : null;
}
