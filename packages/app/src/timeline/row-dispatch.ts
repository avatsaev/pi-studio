// Row-kind dispatch table — maps each kind to renderer metadata + safe fallback.
// clean-room-scope/features/timeline-rendering.md § Row dispatch

import type { TimelineRowKind } from "./reducer.js";

export type RowRenderer = {
  kind: TimelineRowKind | "unknown";
  component: string;
  /** Max content column width (px). */
  maxWidth: number;
  /** Bottom margin / gap key — resolved by the layout engine. */
  gapKey: RowGapKey;
};

export type RowGapKey =
  | "user-to-user"       // 4
  | "tool-seq-packed"    // 0
  | "user-to-tool"       // 16
  | "assistant-tool"     // 4
  | "block-group"        // 12
  | "default";           // 16

export const ROW_GAP_VALUES: Record<RowGapKey, number> = {
  "user-to-user": 4,
  "tool-seq-packed": 0,
  "user-to-tool": 16,
  "assistant-tool": 4,
  "block-group": 12,
  "default": 16,
};

export const TIMELINE_MAX_CONTENT_WIDTH = 820;

const DISPATCH_TABLE: Record<TimelineRowKind, RowRenderer> = {
  user_message: { kind: "user_message", component: "UserMessageRow", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "user-to-user" },
  assistant_message: { kind: "assistant_message", component: "AssistantMessageRow", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "default" },
  thought: { kind: "thought", component: "ThinkingCard", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "assistant-tool" },
  tool_call: { kind: "tool_call", component: "ToolCallCard", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "tool-seq-packed" },
  todo_list: { kind: "todo_list", component: "TodoListCard", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "default" },
  activity_log: { kind: "activity_log", component: "ActivityLogPill", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "default" },
  compaction: { kind: "compaction", component: "CompactionMarker", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "default" },
  unknown: { kind: "unknown", component: "UnknownRowFallback", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "default" },
};

export function dispatchRow(kind: TimelineRowKind): RowRenderer {
  return DISPATCH_TABLE[kind] ?? DISPATCH_TABLE.unknown;
}

export function resolveRowGap(current: TimelineRowKind, next: TimelineRowKind | undefined): number {
  if (!next) return ROW_GAP_VALUES.default;
  if (current === "user_message" && next === "user_message") return ROW_GAP_VALUES["user-to-user"];
  if (current === "tool_call" && next === "tool_call") return ROW_GAP_VALUES["tool-seq-packed"];
  if (current === "user_message" && next === "tool_call") return ROW_GAP_VALUES["user-to-tool"];
  if (
    (current === "assistant_message" || current === "thought") &&
    (next === "tool_call" || next === "thought")
  ) return ROW_GAP_VALUES["assistant-tool"];
  if (
    (current === "tool_call" || current === "thought") &&
    (next === "assistant_message" || next === "thought")
  ) return ROW_GAP_VALUES["assistant-tool"];
  return ROW_GAP_VALUES.default;
}

export function isKnownRowKind(kind: string): kind is TimelineRowKind {
  return kind in DISPATCH_TABLE;
}

export function safeKind(kind: string): TimelineRowKind {
  return isKnownRowKind(kind) ? kind : "unknown";
}
