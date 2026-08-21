/**
 * `computeAnnouncements` — § 08's "Announcements" table as pure decision logic over an
 * `AgentUiState` transition. Never touches the DOM or a store; `stores/announcer-store.ts` is the
 * one consumer that turns its output into a spoken live-region update (sprint-069/task-008).
 *
 * Reuses `outcome-line.ts`'s own resolution classification rather than re-deriving one (this
 * task's own Notes) — including its wire-limitation posture: a populated `select`/`input`'s
 * second-Esc dismissal resolves as a bare `{ cancelled: true }`, indistinguishable on the wire
 * from a resolution by another client, so `outcome-line.ts` renders both as "no longer pending"
 * and this module inherits exactly that call rather than promising a "Dismissed" string the wire
 * cannot attribute.
 *
 * Two rules mirrored from `outcome-line.ts`'s own header, restated here because an announcement is
 * an even sharper case of both:
 * - **Never echo a typed or extension-chosen value.** `outcomeLine`'s `text` for a `select`
 *   response is the literal option string (the card MAY print it — § 04 permits it because the
 *   options are a fixed set the extension already chose); the announcement never does. Every
 *   `tone: "success"` outcome collapses to the one generic word "Answered", regardless of method
 *   or answer.
 * - **Never announce absence.** This module has nothing to say about "nothing pending anywhere" —
 *   that transition has no announcement string at all (§ 08's own table entry is "region emptied,
 *   nothing spoken"); the caller (`agent-ui-store.ts`) detects the global-pending-count-reaches-
 *   zero case itself and clears the live region, not by asking this module for a message.
 */

import type { AgentUiPendingEntry, AgentUiResolvedEntry, AgentUiState } from "@av-pi-studio/client";
import { outcomeLine } from "./outcome-line.js";

export type AnnouncementPoliteness = "polite" | "assertive";

export interface Announcement {
  text: string;
  politeness: AnnouncementPoliteness;
}

export interface AnnouncementContext {
  /** The agent id of the session currently on screen — same "active session" concept
   *  `notifyEffect` already uses (`session-store.ts`'s `activeSessionId`), not per-pane
   *  visibility. `null` when no session is active. */
  activeAgentId: string | null;
  /** Resolves a session's display name from its agent id; `null` when not locally known
   *  (defensive — mirrors `notifyEffect`'s own posture of never throwing on a miss). */
  sessionTitle: (agentId: string) => string | null;
}

/** § 08's session locator falls back to "Chat" on an empty/unknown title, matching
 *  `notifyToastCopy`'s own existing fallback for the same situation. */
function locate(title: string | null): string {
  return title || "Chat";
}

function pendingCountForAgent(
  pending: Record<string, AgentUiPendingEntry>,
  agentId: string,
): number {
  let count = 0;
  for (const entry of Object.values(pending)) if (entry.agentId === agentId) count++;
  return count;
}

function payloadTitle(payload: Record<string, unknown>): string | undefined {
  const value = payload.title;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** § 08's four resolution rows (answered/submitted, dismissed/declined, expired, no-longer-
 *  pending), generalised from `outcome-line.ts`'s tone/text decision. */
function resolutionCopy(entry: AgentUiResolvedEntry): string {
  const outcome = outcomeLine(entry);
  if (outcome.tone === "success") return "Answered";
  if (outcome.text === "declined") return "Dismissed";
  if (outcome.text === "expired") return "Expired";
  return "No longer pending"; // "no longer pending" itself, and any unrecognised reason alike.
}

/** Diffs one `AgentUiState` commit against the previous one and returns every § 08 announcement it
 *  produces, in the order they should be spoken. Almost always 0 or 1 entries — each commit
 *  corresponds to exactly one wire action — but the loop is written generally rather than assuming
 *  that.
 *
 *  A pending entry only announces its **arrival** when it was observed live
 *  (`entry.receivedAt !== undefined` — `agent-ui-state.ts`'s own field doc: stamped only by a live
 *  `ui_request`, absent for a snapshot/resync-recovered entry). A resolved entry always announces
 *  — `agent-ui-state.ts`: "Resolved entries are never 'recovered'", so anything newly present in
 *  `next.resolved` happened live while this page was open. */
export function computeAnnouncements(
  prev: AgentUiState,
  next: AgentUiState,
  ctx: AnnouncementContext,
): Announcement[] {
  const out: Announcement[] = [];

  for (const entry of Object.values(next.pending)) {
    if (entry.receivedAt === undefined) continue;
    if (prev.pending[entry.requestId] !== undefined) continue;
    const priorCount = pendingCountForAgent(prev.pending, entry.agentId);
    if (priorCount === 0) {
      if (entry.agentId === ctx.activeAgentId) {
        const prompt = payloadTitle(entry.payload);
        out.push({
          text: prompt ? `A question needs input: ${prompt}` : "A question needs input",
          politeness: "polite",
        });
      } else {
        out.push({
          text: `A question needs input in ${locate(ctx.sessionTitle(entry.agentId))}`,
          politeness: "polite",
        });
      }
    } else {
      out.push({
        text: `${priorCount + 1} questions need input in ${locate(ctx.sessionTitle(entry.agentId))}`,
        politeness: "polite",
      });
    }
  }

  for (const entry of Object.values(next.resolved)) {
    if (prev.resolved[entry.requestId] !== undefined) continue;
    out.push({
      text: `${resolutionCopy(entry)} in ${locate(ctx.sessionTitle(entry.agentId))}`,
      politeness: "polite",
    });
  }

  return out;
}
