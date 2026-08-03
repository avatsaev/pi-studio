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

/** Turn-terminal disposition, latched off each `agent_end` and emitted at `agent_settled`. */
type Disposition = "completed" | "failed" | "canceled";

export interface PiEventMapper {
  /** Map one raw Pi event to an `AgentStreamEvent`, or `null` if it produces no stream event. */
  map(raw: unknown): AgentStreamEvent | null;
}

/**
 * Stateful Pi event mapper (features/agent-sessions.md § Stream events).
 *
 * Real Pi RPC events (docs/rpc.md): `agent_start`/`agent_end`, `turn_start`/`turn_end`,
 * `message_update` (carrying an `assistantMessageEvent` delta), `tool_execution_start|end`, etc.
 *
 * Pi's session run loop emits ONE `agent_end` **per low-level run** — a retryable error,
 * overflow-compaction, or a queued steering/follow-up message all loop into another run before
 * the turn is actually done — and exactly one `agent_settled` at the true end. An `agent_end` is
 * therefore a per-run boundary, not the turn's terminal: this mapper latches the disposition it
 * implies (honouring `willRetry`) and only emits the terminal `turn_completed`/`turn_failed`/
 * `turn_canceled` when `agent_settled` arrives — mirroring the `stopReason` refinement
 * `session-hydration.ts` applies when replaying a persisted session.
 */
export function createPiEventMapper(): PiEventMapper {
  let disposition: Disposition = "completed";
  let error: string | undefined;

  const latch = (next: Disposition, nextError?: string): void => {
    disposition = next;
    error = nextError;
  };

  return {
    map(raw: unknown): AgentStreamEvent | null {
      const event = asRecord(raw);
      const type = str(event.type) ?? str(event.kind);
      if (!type) return null;

      switch (type) {
        // ── Run / turn boundaries ──
        case "agent_start":
          latch("completed");
          return { kind: "turn_started" };
        case "agent_end": {
          // Auto-retry (docs/rpc.md `agent_end.willRetry`): Pi will run again before the turn
          // ends — this run's outcome does not (yet) reflect the turn's outcome.
          if (event.willRetry === true) return null;
          // `event.messages` carries every `AgentMessage` produced by this low-level run. Its
          // FINAL entry's `stopReason` is the same field `session-hydration.ts` reads back out of
          // Pi's persisted JSONL on restore — mirror that mapping here so a failed/aborted run is
          // latched exactly as it would be reported after a reload.
          const messages: Record<string, unknown>[] = Array.isArray(event.messages)
            ? event.messages.map(asRecord)
            : [];
          const last = messages.findLast((m) => m.role === "assistant") ?? {};
          const stopReason = str(last.stopReason);
          if (stopReason === "error") {
            latch("failed", str(last.errorMessage) ?? "error");
          } else if (stopReason === "aborted") {
            latch("canceled");
          } else {
            latch("completed");
          }
          return null;
        }
        case "agent_settled": {
          // The true terminal (docs/rpc.md § agent_settled: Pi will not continue automatically
          // through retry, compaction retry, or queued follow-up messages past this point).
          const result: AgentStreamEvent =
            disposition === "failed"
              ? { kind: "turn_failed", error: error ?? "error" }
              : disposition === "canceled"
                ? { kind: "turn_canceled" }
                : { kind: "turn_completed" };
          latch("completed");
          return result;
        }

        // ── Streaming assistant deltas ──
        case "message_update": {
          const delta = asRecord(event.assistantMessageEvent);
          const dtype = str(delta.type);
          if (dtype === "text_delta") return { kind: "assistant_message", text: str(delta.delta) };
          if (dtype === "thinking_delta") return { kind: "reasoning", text: str(delta.delta) };
          // Block-close markers. Emitted the instant the model stops writing prose — before it
          // streams whatever comes next (a large tool-call payload can take seconds) and long
          // before `agent_end`. Clients use these to finalize the row; see `assistant_message.final`.
          if (dtype === "text_end") return { kind: "assistant_message", final: true };
          if (dtype === "thinking_end") return { kind: "reasoning", final: true };
          if (dtype === "toolcall_end") {
            const tc = asRecord(delta.toolCall);
            return {
              kind: "tool_call",
              callId: str(tc.id),
              tool: mapToolCall(tc),
              status: "started",
            };
          }
          if (dtype === "error") {
            // Streaming-error path that can precede `agent_end` (e.g. a mid-stream provider
            // disconnect) — latch it too so a settle that follows without a clear `stopReason`
            // still reports the right disposition. Still surfaced live as a non-terminal `error`
            // event.
            const reason = str(delta.reason) ?? "error";
            if (reason === "aborted") latch("canceled");
            else latch("failed", reason);
            return { kind: "error", message: reason };
          }
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
    },
  };
}

/**
 * Stateless convenience wrapper — maps a single event through a **fresh** mapper instance. Fine
 * for one-off/unit assertions of turn-agnostic events (`agent_start`, `message_update`,
 * `tool_execution_start|end`, `queue_update`, unknown types). It cannot report a turn's terminal
 * event on its own: since disposition is latched from a *prior* `agent_end` in the same session,
 * a lone `agent_end`/`agent_settled` call here always sees fresh (`"completed"`) state. Callers
 * observing a full turn lifecycle (e.g. `PiAgentSession`) MUST use `createPiEventMapper()` and
 * reuse one instance for the session's lifetime.
 */
export function mapPiEvent(raw: unknown): AgentStreamEvent | null {
  return createPiEventMapper().map(raw);
}
