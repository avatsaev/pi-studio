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

/**
 * Flip a still-streaming assistant/reasoning row to its finalized form, in place on an already
 * copied `rows` array.
 *
 * This is the switch that swaps `AssistantRow`'s live block-by-block streaming render
 * (`StreamingMarkdown`: lean tail, blinking caret) for one canonical `<Markdown>` parse of the
 * whole text, so it must fire the moment a row can no longer grow. Clearing the streaming *index*
 * without clearing the row's `streaming` flag (what this reducer used to do on `tool_call`) strands
 * the row mid-stream forever — caret still blinking, last block never highlighted — because
 * `turn_completed` only ever finalizes the index it still holds, which is `null` by then.
 */
function finalizeRow(rows: TimelineRow[], index: number | null): void {
  if (index === null) return;
  const row = rows[index];
  if (!row) return;
  if (row.kind !== "assistant" && row.kind !== "reasoning") return;
  if (!row.streaming) return;
  rows[index] = { ...row, streaming: false };
}

/** Close both streaming rows — the stream has moved on to something that is neither. */
function finalizeStreamingRows(state: TimelineState): TimelineState {
  if (state.streamingAssistantIndex === null && state.streamingReasoningIndex === null) {
    return state;
  }
  const rows = state.rows.slice();
  finalizeRow(rows, state.streamingAssistantIndex);
  finalizeRow(rows, state.streamingReasoningIndex);
  return { ...state, rows, streamingAssistantIndex: null, streamingReasoningIndex: null };
}

/**
 * Reset streaming refs for a new turn (POC: `turn_started` clears `currentBubble`/
 * `currentReasoning`/`toolEls`).
 *
 * `toolIndexByCallId` intentionally persists across turns — the POC only cleared `st.toolEls` on
 * `turn_started`, but tool rows themselves remain in the DOM; dedupe-by-callId is scoped to the
 * whole session, not the turn, and callIds are unique per invocation anyway.
 */
function onTurnStarted(state: TimelineState): TimelineState {
  return finalizeStreamingRows(state);
}

/**
 * `final` marks a block-close marker (Pi's `text_end`, mapped in the daemon's `event-mapper.ts`)
 * or a whole hydrated block — either way the text will not grow, so the row finalizes now rather
 * than at `turn_completed`, which is a whole tool loop away.
 */
function onAssistantMessage(
  state: TimelineState,
  text: string,
  final: boolean,
  timestamp?: string,
): TimelineState {
  const rows = state.rows.slice();
  finalizeRow(rows, state.streamingReasoningIndex); // POC: assistant_message clears currentReasoning
  let index = state.streamingAssistantIndex;
  if (index === null || rows[index]?.kind !== "assistant") {
    // A textless `final` marker with no open row has nothing to close — never open an empty row.
    if (!text)
      return { ...state, rows, streamingAssistantIndex: null, streamingReasoningIndex: null };
    const row: TimelineRow = {
      kind: "assistant",
      id: nextRowId(),
      text: "",
      streaming: true,
      timestamp,
    };
    rows.push(row);
    index = rows.length - 1;
  }
  const row = rows[index];
  if (!row || row.kind !== "assistant") return state; // unreachable given the guard above
  rows[index] = { ...row, text: row.text + text, streaming: !final };
  return {
    ...state,
    rows,
    streamingAssistantIndex: final ? null : index,
    streamingReasoningIndex: null,
  };
}

function onReasoning(
  state: TimelineState,
  text: string,
  final: boolean,
  timestamp?: string,
): TimelineState {
  const rows = state.rows.slice();
  finalizeRow(rows, state.streamingAssistantIndex); // POC: reasoning clears currentBubble
  let index = state.streamingReasoningIndex;
  if (index === null || rows[index]?.kind !== "reasoning") {
    if (!text)
      return { ...state, rows, streamingAssistantIndex: null, streamingReasoningIndex: null };
    const row: TimelineRow = {
      kind: "reasoning",
      id: nextRowId(),
      text: "",
      streaming: true,
      timestamp,
    };
    rows.push(row);
    index = rows.length - 1;
  }
  const row = rows[index];
  if (!row || row.kind !== "reasoning") return state;
  rows[index] = { ...row, text: row.text + text, streaming: !final };
  return {
    ...state,
    rows,
    streamingReasoningIndex: final ? null : index,
    streamingAssistantIndex: null,
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
  timestamp?: string,
): TimelineState {
  const key = toolCallKey(event.callId, event.tool);
  const status =
    event.status === "completed" || event.status === "error" ? event.status : "running";
  const existingIndex = state.toolIndexByCallId[key];
  const rows = state.rows.slice();
  // A tool call means the prose that preceded it is done — finalize it now instead of leaving it
  // in the plain-text streaming tier until the whole turn ends.
  finalizeRow(rows, state.streamingAssistantIndex);
  finalizeRow(rows, state.streamingReasoningIndex);

  if (existingIndex !== undefined && rows[existingIndex]?.kind === "tool") {
    const row = rows[existingIndex];
    if (row.kind !== "tool") return state;
    const statusText = event.status ?? row.statusText;
    rows[existingIndex] = {
      ...row,
      tool: mergeTool(row.tool, event.tool),
      status,
      ...(statusText !== undefined ? { statusText } : {}),
    };
    return {
      ...state,
      rows,
      streamingAssistantIndex: null,
      streamingReasoningIndex: null,
    };
  }

  // Stamped ONLY here, in the create branch — never in the upsert above. The row must keep the
  // call's start time for its whole life, or it would slide past any extension dialog raised
  // during the call as soon as the status changed (see `ask-placement.ts`).
  const row: TimelineRow = {
    kind: "tool",
    id: nextRowId(),
    callId: key,
    tool: event.tool,
    status,
    ...(event.status !== undefined ? { statusText: event.status } : {}),
    timestamp,
  };
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
  return finalizeStreamingRows(state);
}

function onTurnFailed(
  state: TimelineState,
  error: string | undefined,
  timestamp?: string,
): TimelineState {
  const finalized = onTurnCompleted(state);
  const row: TimelineRow = {
    kind: "error",
    id: nextRowId(),
    text: error || "turn failed",
    timestamp,
  };
  return { ...finalized, rows: [...finalized.rows, row] };
}

function onTurnCanceled(state: TimelineState, timestamp?: string): TimelineState {
  const finalized = onTurnCompleted(state);
  const row: TimelineRow = { kind: "system", id: nextRowId(), text: "(canceled)", timestamp };
  return { ...finalized, rows: [...finalized.rows, row] };
}

function onError(
  state: TimelineState,
  message: string | undefined,
  timestamp?: string,
): TimelineState {
  const row: TimelineRow = { kind: "error", id: nextRowId(), text: message || "error", timestamp };
  return { ...state, rows: [...state.rows, row] };
}

function onUserMessage(
  state: TimelineState,
  text: string,
  images?: Array<{ mimeType?: string; data?: string }>,
  messageId?: string,
  timestamp?: string,
): TimelineState {
  // Reconcile against the optimistic row `Composer` inserted synchronously on Send (same
  // `clientMessageId`, echoed back verbatim by the daemon as this event's `messageId` — see
  // `packages/server/src/agent/agent-service.ts` `runTurn`): confirm it in place instead of
  // appending a duplicate. No match (session-restore replay, or a `messageId` the daemon minted
  // itself) → append fresh, already-confirmed.
  if (messageId !== undefined) {
    const idx = state.rows.findIndex(
      (r) => r.kind === "user" && r.pending && r.clientMessageId === messageId,
    );
    if (idx !== -1) {
      const rows = state.rows.slice();
      const prev = rows[idx];
      if (prev?.kind === "user") {
        // The server's broadcast carries the canonical timestamp — prefer it over the
        // optimistic echo's client-clock guess.
        rows[idx] = {
          ...prev,
          text,
          images,
          pending: false,
          ...(timestamp !== undefined ? { timestamp } : {}),
        };
        return { ...state, rows };
      }
    }
  }
  const row: TimelineRow = {
    kind: "user",
    id: nextRowId(),
    text,
    images,
    clientMessageId: messageId,
    timestamp,
  };
  return { ...state, rows: [...state.rows, row] };
}

/**
 * `queue_update` carries the pending-steering queue as raw strings, not ids (Pi's `steer`/
 * `follow_up` RPC has no message-id concept — see `provider-contract.ts`). Clear the `queued` flag
 * on any row whose text no longer appears in `steering[]`: Pi has handed it to the LLM. Rows are
 * matched by exact text, best-effort — sufficient for a UX badge, not a precise queue model.
 */
function onQueueUpdate(state: TimelineState, steering: readonly string[]): TimelineState {
  let changed = false;
  const rows = state.rows.map((row) => {
    if (row.kind !== "user" || !row.queued) return row;
    if (steering.includes(row.text)) return row;
    changed = true;
    return { ...row, queued: false };
  });
  return changed ? { ...state, rows } : state;
}

/** Apply one `AgentStreamEvent` to timeline state. Pure — no mutation of the input. */
export function applyStreamEvent(
  state: TimelineState,
  event: AgentStreamEvent,
  timestamp?: string,
): TimelineState {
  switch (event.kind) {
    case "turn_started":
      return onTurnStarted(state);
    case "user_message":
      return onUserMessage(state, event.text ?? "", event.images, event.messageId, timestamp);
    case "assistant_message":
      return onAssistantMessage(state, event.text ?? "", event.final ?? false, timestamp);
    case "reasoning":
      return onReasoning(state, event.text ?? "", event.final ?? false, timestamp);
    case "tool_call":
      return onToolCall(state, event, timestamp);
    case "turn_completed":
      return onTurnCompleted(state);
    case "turn_failed":
      return onTurnFailed(state, event.error, timestamp);
    case "turn_canceled":
      return onTurnCanceled(state, timestamp);
    case "error":
      return onError(state, event.message, timestamp);
    case "queue_update":
      return onQueueUpdate(state, event.steering ?? []);
    default:
      return state; // unknown/future kind - ignore rather than throw (append-only wire contract)
  }
}

/** Replay a whole ordered event list (session restore / timeline hydration) into fresh state. */
export function replayEvents(
  events: readonly { event: AgentStreamEvent; timestamp?: string }[],
): TimelineState {
  return events.reduce(
    (state, { event, timestamp }) => applyStreamEvent(state, event, timestamp),
    EMPTY_TIMELINE,
  );
}

/**
 * Insert the local optimistic echo `Composer` renders synchronously on Send/Steer, before the
 * daemon's `create_agent_request`/`send_agent_prompt`/`steer_agent_request` round trip resolves.
 * Keyed by the same `clientMessageId` sent on the RPC — the eventual `user_message` broadcast
 * (`onUserMessage` above) reconciles this row in place by matching `pending` + `clientMessageId`,
 * so the row never duplicates once the server confirms it. `queued: true` marks a steered message
 * (cleared later by `onQueueUpdate` above); a normal send never sets it.
 */
export function addOptimisticUserMessage(
  state: TimelineState,
  clientMessageId: string,
  text: string,
  images?: Array<{ mimeType?: string; data?: string }>,
  queued?: boolean,
  timestamp?: string,
): TimelineState {
  const row: TimelineRow = {
    kind: "user",
    id: nextRowId(),
    text,
    images,
    clientMessageId,
    pending: true,
    queued,
    timestamp,
  };
  return { ...state, rows: [...state.rows, row] };
}

/**
 * Mark a still-pending optimistic row as failed — the RPC that was meant to confirm it
 * (`createAgent`/`send`) rejected before any `user_message` broadcast arrived. No-op if the row
 * was already reconciled (server confirmed it before the RPC promise settled — the RPC contract
 * is "resolves after the whole turn", so a `user_message` broadcast can arrive, then the promise
 * can still reject later from a failure elsewhere in that same turn; the row is already correct
 * by then and must not be clobbered back into a failed state).
 */
export function markUserMessageFailed(
  state: TimelineState,
  clientMessageId: string,
): TimelineState {
  const idx = state.rows.findIndex(
    (r) => r.kind === "user" && r.pending && r.clientMessageId === clientMessageId,
  );
  if (idx === -1) return state;
  const rows = state.rows.slice();
  const prev = rows[idx];
  if (prev?.kind !== "user") return state;
  rows[idx] = { ...prev, pending: false, failed: true };
  return { ...state, rows };
}

export { EMPTY_TIMELINE };
export type { TimelineState, TimelineRow };
