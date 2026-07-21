/**
 * TimelineRow — the render model streamed/replayed chat rows collapse into.
 * Discriminated union mirrors the POC's per-kind DOM append logic
 * (`handleAgentStream`, POC_TO_APP_PLAN_UI.md §4.3) without the DOM.
 */

import type { ToolCallDetail } from "@av-pi-studio/protocol";

export type ToolCallStatus = "running" | "completed" | "error";

export interface UserRow {
  kind: "user";
  id: string;
  text: string;
  images?: Array<{ mimeType?: string; data?: string }>;
  /**
   * Client-generated id passed as `clientMessageId` on `createAgent`/`send` (features/
   * agent-sessions.md — the daemon echoes it back verbatim as the canonical `user_message`
   * event's `messageId` since the live pi provider never mints its own). Lets the optimistic
   * row inserted on Send reconcile against the server's broadcast instead of duplicating it.
   * Undefined for rows sourced from session-restore hydration/replay, which had no local
   * optimistic counterpart to reconcile against.
   */
  clientMessageId?: string;
  /**
   * True from the moment `Composer` inserts this row locally until the server's `user_message`
   * broadcast for the same `clientMessageId` confirms it (see `reducer.ts`'s `onUserMessage`).
   * Hydrated/replayed rows are never pending — they are already server-confirmed history.
   */
  pending?: boolean;
  /**
   * True when the RPC that was supposed to confirm this row (`createAgent`/`send`) rejected
   * before any `user_message` broadcast arrived — e.g. a dropped connection. Never confirmed,
   * never retried automatically; `pending` is cleared alongside it (see `reducer.ts`'s
   * `markUserMessageFailed`) so the row stops showing a spinner and shows a failure indicator
   * instead.
   */
  failed?: boolean;
}

export interface AssistantRow {
  kind: "assistant";
  id: string;
  text: string;
  /** True while more `assistant_message` deltas for this turn may still arrive. */
  streaming: boolean;
}

export interface ReasoningRow {
  kind: "reasoning";
  id: string;
  text: string;
  streaming: boolean;
}

export interface ToolRow {
  kind: "tool";
  id: string;
  /** Stable key used to upsert/dedupe: `callId` when present, else `${tool.kind}:${detail}`. */
  callId: string;
  tool: ToolCallDetail;
  status: ToolCallStatus;
}

export interface ErrorRow {
  kind: "error";
  id: string;
  text: string;
}

export interface SystemRow {
  kind: "system";
  id: string;
  text: string;
}

export type TimelineRow = UserRow | AssistantRow | ReasoningRow | ToolRow | ErrorRow | SystemRow;

export interface TimelineState {
  rows: TimelineRow[];
  /** Index into `rows` of the in-progress assistant row, if any (fast tail lookup). */
  streamingAssistantIndex: number | null;
  /** Index into `rows` of the in-progress reasoning row, if any. */
  streamingReasoningIndex: number | null;
  /** callId → row index, for O(1) tool-call upsert. */
  toolIndexByCallId: Record<string, number>;
}

export const EMPTY_TIMELINE: TimelineState = {
  rows: [],
  streamingAssistantIndex: null,
  streamingReasoningIndex: null,
  toolIndexByCallId: {},
};

let rowSeq = 0;
export function nextRowId(): string {
  rowSeq += 1;
  return `row-${rowSeq}`;
}

/** Detail text extracted from a tool-call for display (POC `t.command || t.path || …`). */
export function toolDetailText(tool: ToolCallDetail): string {
  switch (tool.kind) {
    case "shell":
      return tool.command ?? "";
    case "read":
    case "write":
      return tool.path ?? "";
    case "edit":
      return tool.path ?? "";
    case "search":
      return tool.query ?? "";
    case "fetch":
      return tool.url ?? "";
    case "task":
      return tool.description ?? "";
    default:
      return "";
  }
}

/** Stable dedupe key for a tool call (POC `e.callId || (t.kind + ":" + detail)`). */
export function toolCallKey(callId: string | undefined, tool: ToolCallDetail): string {
  return callId ?? `${tool.kind}:${toolDetailText(tool)}`;
}
