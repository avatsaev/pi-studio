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
  /**
   * True from the moment a steered message is optimistically inserted (`Composer`'s Steer path,
   * `clientMessageId`/`queued: true` on `addOptimisticUserMessage`) until a `queue_update` stream
   * event no longer lists this row's `text` in its `steering[]` array — i.e. Pi has handed the
   * steering message to the LLM. Best-effort text correlation (`queue_update` carries strings, not
   * ids — see `reducer.ts`'s `onQueueUpdate`). Never set on a normal (non-steered) send.
   */
  queued?: boolean;
  /**
   * Daemon-owned ISO-8601 timestamp of the row that introduced this message (the optimistic
   * echo stamps `new Date().toISOString()` immediately on Send; the server's `user_message`
   * broadcast overwrites it with the canonical value on confirmation). Undefined only if it
   * arrived through a code path that predates this field (never happens for rows created going
   * forward).
   */
  timestamp?: string;
}

export interface AssistantRow {
  kind: "assistant";
  id: string;
  text: string;
  /**
   * True while more `assistant_message` deltas may still land in *this* row. Cleared as soon as
   * the block closes (`assistant_message.final`, a following tool call, or a turn boundary) —
   * that is the flag `AssistantRow` reads to switch from plain text to rendered markdown, so it
   * must never outlive the block it describes.
   */
  streaming: boolean;
  /** ISO-8601 timestamp of the row's first chunk (set once, at creation — never on later deltas). */
  timestamp?: string;
}

export interface ReasoningRow {
  kind: "reasoning";
  id: string;
  text: string;
  /** Same contract as `AssistantRow.streaming`. */
  streaming: boolean;
  /** Same contract as `AssistantRow.timestamp`. */
  timestamp?: string;
}

export interface ToolRow {
  kind: "tool";
  id: string;
  /** Stable key used to upsert/dedupe: `callId` when present, else `${tool.kind}:${detail}`. */
  callId: string;
  tool: ToolCallDetail;
  status: ToolCallStatus;
  /**
   * The wire's raw, free-form `tool_call.status` string (`messages.ts`'s `status: z.string()`),
   * alongside the normalized `status` above. `status` still drives border/wash treatment; this
   * carries provider-specific values (e.g. `"awaiting_approval"`) a card can render as plain text
   * instead of collapsing them into `"running"`. Unset when no event for this row has carried one.
   */
  statusText?: string;
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
