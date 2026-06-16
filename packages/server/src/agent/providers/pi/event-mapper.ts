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

/** Map a Pi tool-call payload to a normalized `ToolCallDetail`. */
export function mapToolCall(raw: unknown): ToolCallDetail {
  const tool = asRecord(raw);
  const name = (str(tool.name) ?? str(tool.tool) ?? "").toLowerCase();
  const input = asRecord(tool.input ?? tool.arguments ?? tool.args);
  switch (name) {
    case "shell":
    case "bash":
    case "exec":
    case "run":
      return { kind: "shell", command: str(input.command) ?? str(input.cmd) };
    case "read":
    case "read_file":
    case "cat":
      return { kind: "read", path: str(input.path) ?? str(input.file) };
    case "edit":
    case "apply_patch":
    case "patch":
      return { kind: "edit", path: str(input.path), diff: str(input.diff) ?? str(input.patch) };
    case "write":
    case "write_file":
    case "create":
      return { kind: "write", path: str(input.path) ?? str(input.file) };
    case "search":
    case "grep":
    case "glob":
      return { kind: "search", query: str(input.query) ?? str(input.pattern) };
    case "fetch":
    case "web_fetch":
    case "http":
      return { kind: "fetch", url: str(input.url) };
    case "task":
    case "agent":
    case "subagent":
      return { kind: "task", description: str(input.description) ?? str(input.prompt) };
    default:
      // Unknown provider tool → surface as a task with the raw name as description.
      return { kind: "task", description: name || undefined };
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
    case "agent_end":
      return { kind: "turn_completed" };

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
        tool: mapToolCall({ name: str(event.toolName), arguments: event.args }),
        status: "running",
      };
    case "tool_execution_end":
      return {
        kind: "tool_call",
        callId: str(event.toolCallId),
        tool: mapToolCall({ name: str(event.toolName), arguments: event.args }),
        status: event.isError ? "error" : "completed",
      };

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
    case "queue_update":
    case "compaction_start":
    case "compaction_end":
    case "auto_retry_start":
    case "auto_retry_end":
      return null;

    default:
      return null;
  }
}
