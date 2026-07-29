import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";

import type { TimelineRow } from "../../timeline-store.js";
import { mapToolCall } from "./event-mapper.js";

/**
 * Rehydrate a daemon `TimelineRow[]` from Pi's own on-disk JSONL session file (docs:
 * session-format.md § SessionMessageEntry). Pi persists the full conversation (messages, tool
 * calls/results, diffs) independently of Pi-Studio's daemon-owned `AgentTimelineStore`, which
 * lives only in memory and is lost on daemon restart. Rather than duplicating that persistence,
 * the daemon rebuilds its timeline from Pi's file on demand — the single source of truth for
 * conversation content is Pi's session file, not a daemon-side copy.
 *
 * Only the active branch (root → current leaf, resolved through forks/compaction by
 * `SessionManager.getBranch()`) is replayed — exactly what the live session would have streamed.
 * Row timestamps are taken from the originating session entry (Pi-owned replay time), matching the
 * "daemon-owned, provider-may-supply-original-replay-timestamps" rule in timeline-streaming.md.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text?: string } => asRecord(block).type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

/** Extract `ImageContent` blocks (`{type:"image", data, mimeType}`, session-format.md) from a
 * persisted user message's `content` array back into the client's `ImageAttachment` shape
 * (`{mimeType, data}`, protocol `imageAttachmentSchema`) — the inverse of `toPiImages()`
 * (`agent.ts`), which is how they got written into Pi's session file in the first place. Returns
 * `undefined` (not `[]`) when there are none, matching the live `user_message` event's shape
 * (`opts.images` is `undefined` for a text-only prompt — `session-operations.ts`). */
function imagesOf(content: unknown): { mimeType?: string; data?: string }[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const images = content
    .filter(
      (block): block is { type: string; data?: string; mimeType?: string } =>
        asRecord(block).type === "image",
    )
    .map((block) => ({ mimeType: block.mimeType, data: block.data }));
  return images.length > 0 ? images : undefined;
}

/** ISO timestamp for an entry: session entries use ISO strings; message timestamps are epoch-ms. */
function timestampOf(entry: SessionEntry): string {
  if (entry.type === "message") {
    const ts = asRecord(entry.message).timestamp;
    if (typeof ts === "number") return new Date(ts).toISOString();
  }
  return entry.timestamp;
}

/** Map one `SessionMessageEntry.message` (an `AgentMessage`) to zero or more stream events. */
function mapMessage(message: unknown): AgentStreamEvent[] {
  const m = asRecord(message);
  switch (m.role) {
    case "user":
      return [{ kind: "user_message", text: textOf(m.content), images: imagesOf(m.content) }];

    case "assistant": {
      const events: AgentStreamEvent[] = [];
      const blocks = Array.isArray(m.content) ? m.content : [];
      for (const raw of blocks) {
        const block = asRecord(raw);
        if (block.type === "text" && typeof block.text === "string" && block.text) {
          events.push({ kind: "assistant_message", text: block.text });
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          events.push({ kind: "reasoning", text: block.thinking });
        } else if (block.type === "toolCall") {
          events.push({
            kind: "tool_call",
            callId: typeof block.id === "string" ? block.id : undefined,
            tool: mapToolCall({ name: block.name, arguments: block.arguments }),
            status: "running",
          });
        }
      }
      return events;
    }

    case "toolResult":
      return [
        {
          kind: "tool_call",
          callId: typeof m.toolCallId === "string" ? m.toolCallId : undefined,
          tool: mapToolCall({
            name: m.toolName,
            result: { details: asRecord(m.details), content: m.content },
          }),
          status: m.isError ? "error" : "completed",
        },
      ];

    case "bashExecution":
      return [
        {
          kind: "tool_call",
          tool: {
            kind: "shell",
            command: typeof m.command === "string" ? m.command : undefined,
            output: typeof m.output === "string" ? m.output : undefined,
          },
          status: m.exitCode === 0 || m.exitCode === undefined ? "completed" : "error",
        },
      ];

    default:
      // custom / branchSummary / compactionSummary entries carry no user-facing timeline row.
      return [];
  }
}

/** Map one session-file entry (message or otherwise) to zero or more stream events. */
function mapEntry(entry: SessionEntry): AgentStreamEvent[] {
  if (entry.type === "message") return mapMessage(entry.message);
  return [];
}

/**
 * Load a Pi session file and replay its active branch into daemon `TimelineRow`s, wrapped with
 * `turn_started`/`turn_completed` (or `turn_failed`/`turn_canceled`, per the closing assistant
 * message's `stopReason`) markers around each user→assistant exchange — the same shape
 * `projectRows` (`timeline-store.ts`) groups for a live run. Each turn gets its own epoch. Returns
 * `[]` for a missing/corrupt/empty file (never throws — a stale handle degrades to an empty
 * timeline, not a crash).
 */
export function hydrateTimelineFromSessionFile(sessionFile: string): TimelineRow[] {
  let entries: SessionEntry[];
  try {
    entries = SessionManager.open(sessionFile).getBranch();
  } catch {
    return [];
  }

  const rows: TimelineRow[] = [];
  let epoch = 0;
  let seq = 0;
  let turnOpen = false;
  /** Closer for the turn in progress, refined as assistant messages arrive within it. */
  let turnCloser: AgentStreamEvent = { kind: "turn_completed" };
  let turnCloserTimestamp = "";

  const push = (event: AgentStreamEvent, timestamp: string): void => {
    rows.push({ epoch, seq: seq++, timestamp, event });
  };

  const closeTurn = (): void => {
    if (!turnOpen) return;
    push(turnCloser, turnCloserTimestamp);
    turnOpen = false;
  };

  for (const entry of entries) {
    const timestamp = timestampOf(entry);
    const isUserMessage = entry.type === "message" && asRecord(entry.message).role === "user";

    if (isUserMessage) {
      closeTurn();
      epoch++;
      for (const event of mapEntry(entry)) push(event, timestamp);
      push({ kind: "turn_started" }, timestamp);
      turnOpen = true;
      turnCloser = { kind: "turn_completed" };
      turnCloserTimestamp = timestamp;
      continue;
    }

    if (entry.type === "message" && asRecord(entry.message).role === "assistant") {
      const stopReason = asRecord(entry.message).stopReason;
      if (stopReason === "error") {
        const errorMessage = asRecord(entry.message).errorMessage;
        turnCloser = {
          kind: "turn_failed",
          error: typeof errorMessage === "string" ? errorMessage : "turn failed",
        };
      } else if (stopReason === "aborted") {
        turnCloser = { kind: "turn_canceled" };
      }
      turnCloserTimestamp = timestamp;
    }

    for (const event of mapEntry(entry)) push(event, timestamp);
  }
  closeTurn();
  return rows;
}
