/**
 * Pure `(TimelineState, AgentStreamEvent) → TimelineState` reducer. Replaces the POC's
 * imperative `handleAgentStream` DOM switch (POC_TO_APP_PLAN_UI.md §4.3). No DOM, no globals —
 * fully unit-testable.
 */

import type { AgentStreamEvent, ToolCallDetail } from "@av-pi-studio/protocol";
import {
  EMPTY_TIMELINE,
  nextRowId,
  toolCallKey,
  type TimelineRow,
  type TimelineState,
} from "./row-model.js";

/** Reset streaming refs for a new turn (POC: `turn_started` clears `currentBubble`/`currentReasoning`/`toolEls`). */
function onTurnStarted(state: TimelineState): TimelineState {
  return {
    ...state,
    streamingAssistantIndex: null,
    streamingReasoningIndex: null,
    // toolIndexByCallId intentionally persists across turns — POC only clears `st.toolEls` on
    // `turn_started`, but tool rows themselves remain in the DOM; dedupe-by-callId is scoped to
    // the whole session, not the turn, and callIds are unique per invocation anyway.
  };
}

function onAssistantMessage(state: TimelineState, text: string): TimelineState {
  const rows = state.rows.slice();
  let index = state.streamingAssistantIndex;
  if (index === null || rows[index]?.kind !== "assistant") {
    const row: TimelineRow = { kind: "assistant", id: nextRowId(), text: "", streaming: true };
    rows.push(row);
    index = rows.length - 1;
  }
  const row = rows[index];
  if (!row || row.kind !== "assistant") return state; // unreachable given the guard above
  rows[index] = { ...row, text: row.text + text };
  return {
    ...state,
    rows,
    streamingAssistantIndex: index,
    streamingReasoningIndex: null, // POC: assistant_message clears currentReasoning
  };
}

function onReasoning(state: TimelineState, text: string): TimelineState {
  const rows = state.rows.slice();
  let index = state.streamingReasoningIndex;
  if (index === null || rows[index]?.kind !== "reasoning") {
    const row: TimelineRow = { kind: "reasoning", id: nextRowId(), text: "", streaming: true };
    rows.push(row);
    index = rows.length - 1;
  }
  const row = rows[index];
  if (!row || row.kind !== "reasoning") return state;
  rows[index] = { ...row, text: row.text + text };
  return {
    ...state,
    rows,
    streamingReasoningIndex: index,
    streamingAssistantIndex: null, // POC: reasoning clears currentBubble
  };
}

/**
 * Merge tool detail across upserts for the same callId. Pi splits detail across events: the
 * command/path arrive on `tool_execution_start` (→ status "running") while the edit diff and the
 * command's output arrive only on `tool_execution_end` (→ "completed"/"error"), which carries no
 * args. Overwriting wholesale would blank the command/path when the end event lands, so we keep
 * each existing non-empty field unless the incoming event provides a value for it. Same `kind`
 * always (both events describe the same tool), so the union stays well-formed.
 */
function mergeTool(prev: ToolCallDetail, next: ToolCallDetail): ToolCallDetail {
  if (prev.kind !== next.kind) return next;
  const merged: Record<string, unknown> = { ...prev };
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined && value !== "") merged[key] = value;
  }
  return merged as ToolCallDetail;
}

function onToolCall(
  state: TimelineState,
  event: Extract<AgentStreamEvent, { kind: "tool_call" }>,
): TimelineState {
  const key = toolCallKey(event.callId, event.tool);
  const status = event.status === "completed" || event.status === "error" ? event.status : "running";
  const existingIndex = state.toolIndexByCallId[key];
  const rows = state.rows.slice();

  if (existingIndex !== undefined && rows[existingIndex]?.kind === "tool") {
    const row = rows[existingIndex];
    if (row.kind !== "tool") return state;
    rows[existingIndex] = { ...row, tool: mergeTool(row.tool, event.tool), status };
    return {
      ...state,
      rows,
      streamingAssistantIndex: null,
      streamingReasoningIndex: null,
    };
  }

  const row: TimelineRow = { kind: "tool", id: nextRowId(), callId: key, tool: event.tool, status };
  rows.push(row);
  return {
    ...state,
    rows,
    toolIndexByCallId: { ...state.toolIndexByCallId, [key]: rows.length - 1 },
    streamingAssistantIndex: null,
    streamingReasoningIndex: null,
  };
}

function onTurnCompleted(state: TimelineState): TimelineState {
  const rows = state.rows.slice();
  if (state.streamingAssistantIndex !== null) {
    const row = rows[state.streamingAssistantIndex];
    if (row?.kind === "assistant") rows[state.streamingAssistantIndex] = { ...row, streaming: false };
  }
  if (state.streamingReasoningIndex !== null) {
    const row = rows[state.streamingReasoningIndex];
    if (row?.kind === "reasoning") rows[state.streamingReasoningIndex] = { ...row, streaming: false };
  }
  return { ...state, rows, streamingAssistantIndex: null, streamingReasoningIndex: null };
}

function onTurnFailed(state: TimelineState, error: string | undefined): TimelineState {
  const finalized = onTurnCompleted(state);
  const row: TimelineRow = { kind: "error", id: nextRowId(), text: error || "turn failed" };
  return { ...finalized, rows: [...finalized.rows, row] };
}

function onTurnCanceled(state: TimelineState): TimelineState {
  const finalized = onTurnCompleted(state);
  const row: TimelineRow = { kind: "system", id: nextRowId(), text: "(canceled)" };
  return { ...finalized, rows: [...finalized.rows, row] };
}

function onError(state: TimelineState, message: string | undefined): TimelineState {
  const row: TimelineRow = { kind: "error", id: nextRowId(), text: message || "error" };
  return { ...state, rows: [...state.rows, row] };
}

function onUserMessage(
  state: TimelineState,
  text: string,
  images?: Array<{ mimeType?: string; data?: string }>,
): TimelineState {
  const row: TimelineRow = { kind: "user", id: nextRowId(), text, images };
  return { ...state, rows: [...state.rows, row] };
}

/** Apply one `AgentStreamEvent` to timeline state. Pure — no mutation of the input. */
export function applyStreamEvent(state: TimelineState, event: AgentStreamEvent): TimelineState {
  switch (event.kind) {
    case "turn_started":
      return onTurnStarted(state);
    case "user_message":
      return onUserMessage(state, event.text ?? "", event.images);
    case "assistant_message":
      return onAssistantMessage(state, event.text ?? "");
    case "reasoning":
      return onReasoning(state, event.text ?? "");
    case "tool_call":
      return onToolCall(state, event);
    case "turn_completed":
      return onTurnCompleted(state);
    case "turn_failed":
      return onTurnFailed(state, event.error);
    case "turn_canceled":
      return onTurnCanceled(state);
    case "error":
      return onError(state, event.message);
    default:
      return state; // unknown/future kind — ignore gracefully (append-only protocol)
  }
}

/** Replay a whole ordered event list (session restore / timeline hydration) into fresh state. */
export function replayEvents(events: readonly AgentStreamEvent[]): TimelineState {
  return events.reduce(applyStreamEvent, EMPTY_TIMELINE);
}

export { EMPTY_TIMELINE };
export type { TimelineState, TimelineRow };
