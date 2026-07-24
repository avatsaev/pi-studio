import type { AgentStreamEvent, ToolCallDetail } from "@av-pi-studio/protocol";

/**
 * Maps raw Pi RPC events → provider-neutral `AgentStreamEvent`s, and Pi tool calls →
 * `ToolCallDetail` kinds (features/agent-sessions.md § Stream events). The exact Pi event schema is
 * TODO(verify); this mapper tolerates `type`/`kind` discriminants and common field names.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Join `result.content` text blocks (Pi RPC `tool_execution_end` shape) into one string. */
function outputOf(tool: Record<string, unknown>): string | undefined {
  const content = asRecord(tool.result).content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((block): block is { type: string; text?: string } => asRecord(block).type === "text")
    .map((block) => block.text ?? "")
    .join("");
  return text || undefined;
}

/**
 * Map a Pi tool-call payload to a normalized `ToolCallDetail`. Accepts either a
 * `tool_execution_start`-shaped record (`toolName` + `args`) or a `tool_execution_end`-shaped one
 * (`toolName` + `result`, no `args`). For `edit`, the human-readable unified `patch` is only
 * present on the *end* event under `result.details.patch`, so it is pulled from there when args
 * carry no diff. `output` (tool stdout/result text) is only present on *end* events — `start`
 * events have no `result` yet, so `outputOf` yields `undefined` for them, which is correct.
 */
export function mapToolCall(raw: unknown): ToolCallDetail {
  const tool = asRecord(raw);
  const name = (str(tool.name) ?? str(tool.tool) ?? str(tool.toolName) ?? "").toLowerCase();
  const input = asRecord(tool.input ?? tool.arguments ?? tool.args);
  const resultDetails = asRecord(asRecord(tool.result).details);
  const output = outputOf(tool);
  switch (name) {
    case "shell":
    case "bash":
    case "exec":
    case "run":
      return { kind: "shell", command: str(input.command) ?? str(input.cmd), output };
    case "read":
    case "read_file":
    case "cat":
      return { kind: "read", path: str(input.path) ?? str(input.file), output };
    case "edit":
    case "apply_patch":
    case "patch":
      return {
        kind: "edit",
        path: str(input.path),
        diff:
          str(input.diff) ??
          str(input.patch) ??
          str(resultDetails.patch) ??
          str(resultDetails.diff),
        output,
      };
    case "write":
    case "write_file":
    case "create":
      return { kind: "write", path: str(input.path) ?? str(input.file), output };
    case "search":
    case "grep":
    case "glob":
      return { kind: "search", query: str(input.query) ?? str(input.pattern), output };
    case "fetch":
    case "web_fetch":
    case "http":
      return { kind: "fetch", url: str(input.url), output };
    case "task":
    case "agent":
    case "subagent":
      return { kind: "task", description: str(input.description) ?? str(input.prompt), output };
    default:
      // Unknown provider tool → surface as a task with the raw name as description.
      return { kind: "task", description: name || undefined, output };
  }
}

/** Map one raw Pi event to an `AgentStreamEvent`, or `null` if it is not a stream event.
 *
 * Real Pi RPC events (docs/rpc.md): `agent_start`/`agent_end`, `turn_start`/`turn_end`,
 * `message_update` (carrying an `assistantMessageEvent` delta), `tool_execution_start|end`, etc.
 */
export function mapPiEvent(raw: unknown): AgentStreamEvent | null {
  const event = asRecord(raw);
  const type = str(event.type) ?? str(event.kind);
  if (!type) return null;

  switch (type) {
    // ── Run / turn boundaries ──
    case "agent_start":
      return { kind: "turn_started" };
    case "agent_end": {
      // `event.messages` carries every `AgentMessage` produced by this low-level run (rpc.md
      // "agent_end"). Its FINAL entry's `stopReason` is the same field `session-hydration.ts`
      // reads back out of Pi's persisted JSONL on restore — mirror that mapping here so a
      // failed/aborted run is reported live exactly as it would be after a reload, instead of
      // unconditionally reporting success (the only place a live turn's outcome is decided; a
      // wrong verdict here means neither the live UI nor `agent-service.ts`'s own `newStatus`
      // computation — which trusts this event stream — ever learn the turn failed).
      const messages: Record<string, unknown>[] = Array.isArray(event.messages)
        ? event.messages.map(asRecord)
        : [];
      const last = messages.findLast((m) => m.role === "assistant") ?? {};
      const stopReason = str(last.stopReason);
      if (stopReason === "error") {
        return { kind: "turn_failed", error: str(last.errorMessage) ?? "error" };
      }
      if (stopReason === "aborted") {
        return { kind: "turn_canceled" };
      }
      return { kind: "turn_completed" };
    }

    // ── Streaming assistant deltas ──
    case "message_update": {
      const delta = asRecord(event.assistantMessageEvent);
      const dtype = str(delta.type);
      if (dtype === "text_delta") return { kind: "assistant_message", text: str(delta.delta) };
      if (dtype === "thinking_delta") return { kind: "reasoning", text: str(delta.delta) };
      if (dtype === "toolcall_end") {
        const tc = asRecord(delta.toolCall);
        return {
          kind: "tool_call",
          callId: str(tc.id),
          tool: mapToolCall(tc),
          status: "started",
        };
      }
      if (dtype === "error") return { kind: "error", message: str(delta.reason) ?? "error" };
      return null;
    }

    // ── Tool execution ──
    case "tool_execution_start":
      return {
        kind: "tool_call",
        callId: str(event.toolCallId),
        tool: mapToolCall(event),
        status: "running",
      };
    case "tool_execution_end":
      return {
        kind: "tool_call",
        callId: str(event.toolCallId),
        tool: mapToolCall(event),
        status: event.isError ? "error" : "completed",
      };

    // ── Steering / follow-up queue ──
    case "queue_update": {
      const steering = Array.isArray(event.steering)
        ? event.steering.filter((m): m is string => typeof m === "string")
        : [];
      const followUp = Array.isArray(event.followUp)
        ? event.followUp.filter((m): m is string => typeof m === "string")
        : [];
      return { kind: "queue_update", steering, followUp };
    }

    // ── Errors ──
    case "extension_error":
      return { kind: "error", message: str(event.error) };
    case "error":
      return { kind: "error", message: str(event.message ?? event.error) };

    // ── Ignored (handled elsewhere / not surfaced as timeline events) ──
    case "turn_start":
    case "turn_end":
    case "message_start":
    case "message_end":
    case "tool_execution_update":
    case "compaction_start":
    case "compaction_end":
    case "auto_retry_start":
    case "auto_retry_end":
      return null;

    default:
      return null;
  }
}
