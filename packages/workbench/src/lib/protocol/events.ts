/**
 * `fetch_agent_timeline_request` returns `items: unknown[]` (not yet in the strict protocol
 * union). The POC's `restoreSessions()` observed a stable shape at runtime: each item is
 * `{kind:'other'|'assistant'|'tool_call', event?, events?, timestamp?}` carrying nested
 * `AgentStreamEvent`s. This flattens that shape into a plain event list the timeline reducer can
 * replay, pairing each event with the timestamp of the *row that started it* - an `assistant`/
 * `tool_call` item's `timestamp` is the group's first source row, so only the first flattened
 * event of such a group carries it; later chunks in the same group carry `undefined` (the row
 * they append to already has one).
 */

import type { AgentStreamEvent } from "@av-pi-studio/protocol";

interface TimelineItemOther {
  kind: "other";
  event?: AgentStreamEvent;
  timestamp?: string;
}

interface TimelineItemAssistant {
  kind: "assistant";
  events?: AgentStreamEvent[];
  timestamp?: string;
}

interface TimelineItemToolCall {
  kind: "tool_call";
  events?: AgentStreamEvent[];
  timestamp?: string;
}

type TimelineItem = TimelineItemOther | TimelineItemAssistant | TimelineItemToolCall;

function isTimelineItem(value: unknown): value is TimelineItem {
  return typeof value === "object" && value !== null && "kind" in value;
}

/** One replayable event paired with the timestamp of the row that introduced it, if known. */
export interface TimestampedEvent {
  event: AgentStreamEvent;
  timestamp?: string;
}

/** Flatten authoritative timeline `items` into an ordered, timestamp-paired event list for replay. */
export function flattenTimelineItems(items: readonly unknown[]): TimestampedEvent[] {
  const events: TimestampedEvent[] = [];
  for (const raw of items) {
    if (!isTimelineItem(raw)) continue;
    if (raw.kind === "other") {
      if (raw.event) events.push({ event: raw.event, timestamp: raw.timestamp });
    } else {
      (raw.events ?? []).forEach((event, i) => {
        events.push({ event, timestamp: i === 0 ? raw.timestamp : undefined });
      });
    }
  }
  return events;
}
