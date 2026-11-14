/**
 * `deadline` — the pending card's deadline-bar display state (visual spec § 02, § 05). Derived,
 * never enforced: nothing here expires, dismisses, or resends anything — only the daemon's
 * `agent_ui_resolved` ever ends a dialog (`extension-ui-client-sdk.md` § Timeout display: Pi
 * auto-resolves on timeout and "the client does not need to track timeouts"). This module answers
 * one question only — "how full should the bar look right now" — by consuming the SDK's own
 * `remainingMs` selector rather than recomputing the anchor logic a second, divergent time.
 *
 * `approximate` is true for a snapshot-recovered entry (`receivedAt === undefined` — a live event
 * always stamps one, a rehydrated one cannot) — per § 05, that bar must never be drawn as an exact
 * countdown, since it is anchored on the daemon's `createdAt` from a possibly different host clock.
 *
 * `editor` never carries a `timeout` on Pi's real wire (the visual spec's § 00 table lists one in
 * error — sprint-068/task-009 files the correction), so an `editor` entry always has
 * `timeoutMs === undefined` and needs no special case here: absent `timeoutMs` already yields
 * `show: false`.
 */

import { remainingMs, type AgentUiPendingEntry } from "@av-pi-studio/client";

export interface DeadlineDisplay {
  show: boolean;
  /** Fraction of the deadline remaining, `1` (full) down to `0` (expired). Meaningless when `show`
   *  is `false`. */
  fraction: number;
  approximate: boolean;
}

export function deadline(entry: AgentUiPendingEntry, now: number): DeadlineDisplay {
  if (entry.timeoutMs === undefined) return { show: false, fraction: 0, approximate: false };
  const remaining = remainingMs(entry, now) ?? 0;
  return {
    show: true,
    fraction: Math.max(0, Math.min(1, remaining / entry.timeoutMs)),
    approximate: entry.receivedAt === undefined,
  };
}
