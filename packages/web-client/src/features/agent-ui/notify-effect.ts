/**
 * Pure `notify` effect → toast decision (sprint-069/task-006). Store-free, like
 * `session-presentation.ts`/`tab-attention.ts`: `agent-ui-store.ts` sources the session lookup and
 * calls `useToastStore` with what this module decides.
 *
 * § 11: no extension name is ever available on the wire (`agent-ui-state.ts`'s `AgentUiEffect`
 * only carries `agentId`/`message`/`level`) — the active session's toast is the bare message; a
 * background session's toast is prefixed with the session's own title as a locator, since a title
 * is the only identity available. Level → treatment is a direct 1:1 with `ToastVariant`: `toast.ts`'s
 * existing `"default"` already *is* § 11's "info" (no rail — no separate variant needed), and an
 * unrecognised level falls into that same `default` branch as `"info"` itself, which is exactly
 * what makes "unrecognised ⇒ info" hold without a special case.
 */

import type { ToastVariant } from "@pi-studio-ui/ui/toast.js";

export function notifyVariant(level: string): ToastVariant {
  switch (level) {
    case "warning":
      return "warning";
    case "error":
      return "error";
    default:
      return "default";
  }
}

/** § 11 dwell: info 4s, warning 6s (longer, but still self-dismissing), error sticky (`null`). */
export function notifyDurationMs(level: string): number | null {
  switch (level) {
    case "warning":
      return 6000;
    case "error":
      return null;
    default:
      return 4000;
  }
}

/**
 * @param effectAgentId The `notify` effect's own `agentId`.
 * @param activeSessionAgentId The agentId of the session currently on screen, or `null` if none.
 * @param sessionTitle The effect's own session's title, or `null` if not locally known (defensive
 *   — an effect should always name a real, locally-tracked agent, but this must not throw on a
 *   lookup miss).
 */
export function notifyToastCopy(
  message: string,
  effectAgentId: string,
  activeSessionAgentId: string | null,
  sessionTitle: string | null,
): string {
  if (effectAgentId === activeSessionAgentId) return message;
  return `${sessionTitle || "Chat"} — ${message}`;
}
/**
 * § 11 announcement copy for a `notify` effect — a distinct, colon-separated locator form from
 * `notifyToastCopy`'s own em-dash toast prefix (task-008's own spec text spells out
 * `"<session name>: <message>"`), and a distinct politeness rather than `ToastVariant`: `error`
 * is `"assertive"`, `info`/`warning` are `"polite"` (the same unrecognised-level-behaves-like-info
 * fallback as `notifyVariant`/`notifyDurationMs` above).
 *
 * @param effectAgentId The `notify` effect's own `agentId`.
 * @param activeSessionAgentId The agentId of the session currently on screen, or `null` if none.
 * @param sessionTitle The effect's own session's title, or `null` if not locally known.
 */
export function notifyAnnouncement(
  message: string,
  level: string,
  effectAgentId: string,
  activeSessionAgentId: string | null,
  sessionTitle: string | null,
): { text: string; politeness: "polite" | "assertive" } {
  const text =
    effectAgentId === activeSessionAgentId ? message : `${sessionTitle || "Chat"}: ${message}`;
  return { text, politeness: level === "error" ? "assertive" : "polite" };
}
