/**
 * `fetch_agent_timeline_request` returns `items: unknown[]` (not yet in the strict protocol
 * union). The POC's `restoreSessions()` observed a stable shape at runtime: each item is
 * `{kind:'other'|'assistant'|'tool_call', event?, events?}` carrying nested `AgentStreamEvent`s.
 * This flattens that shape into a plain event list the timeline reducer can replay.
 */

import type { AgentStreamEvent } from "@av-pi-studio/protocol";

interface TimelineItemOther {
  kind: "other";
  event?: AgentStreamEvent;
}

interface TimelineItemAssistant {
  kind: "assistant";
  events?: AgentStreamEvent[];
}

interface TimelineItemToolCall {
  kind: "tool_call";
  events?: AgentStreamEvent[];
}

type TimelineItem = TimelineItemOther | TimelineItemAssistant | TimelineItemToolCall;

function isTimelineItem(value: unknown): value is TimelineItem {
  return typeof value === "object" && value !== null && "kind" in value;
}

/** Flatten authoritative timeline `items` into an ordered `AgentStreamEvent[]` for replay. */
export function flattenTimelineItems(items: readonly unknown[]): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];
  for (const raw of items) {
    if (!isTimelineItem(raw)) continue;
    if (raw.kind === "other") {
      if (raw.event) events.push(raw.event);
    } else {
      for (const event of raw.events ?? []) events.push(event);
    }
  }
  return events;
}
