/**
 * A background chat tab's "attention" state — a projection of its session's status, never new
 * per-tab state. `Tab` has no unread/dirty flag (`stores/tab-store.ts`), and inventing one means
 * owning read-receipt semantics (what marks a tab read? focus? scroll to bottom?) that redesign
 * spec § 07 does not define and nothing else in the app tracks.
 *
 * Only two statuses earn a dot: a turn in progress, or the last one having failed. Every other
 * status (`idle`, `initializing`, `closed`) would paint permanent decoration rather than
 * attention — a `closed` session's tab does not need a green dot forever. The pane's own
 * *active* chat tab never gets a dot either: `TurnProgressBar` already sweeps under the strip
 * while it runs, and an `ErrorRow` already renders a failed turn in the timeline, so a dot
 * directly above either would be the same information twice. This is strictly the
 * background-tab affordance.
 *
 * swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html § 07
 */

import type { AgentStatus as ProtocolAgentStatus } from "@av-pi-studio/protocol";
import type { AgentStatus as DotAgentStatus } from "@pi-studio-ui/ui/status-dot.js";
import { toDotStatus } from "@pi-studio-ui/features/sessions/status-map.js";
import type { Tab } from "@pi-studio-ui/stores/tab-store.js";

/**
 * `sessionStatus` is `undefined` for a chat tab whose session hasn't landed in the store yet (an
 * offline-restore ordering gap) — treated the same as "nothing to show", never a throw.
 * `activeInPane` is whether `tab` is its own pane's active tab (not workspace-active — the same
 * per-pane notion `TabStrip.tsx` already highlights).
 */
export function tabAttentionStatus(
  tab: Tab,
  sessionStatus: ProtocolAgentStatus | "idle" | undefined,
  activeInPane: boolean,
): DotAgentStatus | null {
  if (tab.kind !== "chat" || activeInPane || sessionStatus === undefined) return null;
  const dotStatus = toDotStatus(sessionStatus);
  return dotStatus === "running" || dotStatus === "error" ? dotStatus : null;
}
