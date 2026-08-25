import { z } from "zod";

import { isoTimestampSchema } from "./validation.js";

/**
 * WebSocket wire schemas (architecture/websocket-protocol.md).
 *
 * The protocol mixes JSON text frames (these schemas) with a small binary framing for
 * terminal/file streams (see `binary-frames/`). All schemas are append-only: new fields are
 * optional with defaults, types are never narrowed, fields are never removed.
 *
 * Built up across sprint-002:
 *  - task-001: top-level envelopes + handshake.
 *  - task-003: the session message family union (agent / timeline / permission core).
 */

// ===========================================================================
// Shared wire primitives
// ===========================================================================

/**
 * A wire timestamp. Accepts either an epoch-millis number or an ISO-8601 string so the type is
 * never narrowed across versions (append-only rule).
 */
export const wireTimestampSchema = z.union([z.number(), isoTimestampSchema]);
export type WireTimestamp = z.infer<typeof wireTimestampSchema>;

// ===========================================================================
// Handshake
// ===========================================================================

/** Client kinds that may connect. Desktop connects as `browser` (TODO(verify) MAIN-SCOPE). */
export const clientTypeSchema = z.enum(["mobile", "browser", "cli", "mcp"]);
export type ClientType = z.infer<typeof clientTypeSchema>;

/**
 * Client → Server handshake. Must be the first frame on a connection. `capabilities` advertises
 * the `CLIENT_CAPS.*` flags the client supports (a string→boolean map; see client-capabilities.ts).
 */
export const helloSchema = z.object({
  type: z.literal("hello"),
  clientId: z.string(),
  clientType: clientTypeSchema,
  protocolVersion: z.number(),
  appVersion: z.string().optional(),
  capabilities: z.record(z.string(), z.boolean()).optional(),
});
export type Hello = z.infer<typeof helloSchema>;

/**
 * The `server_info` payload carried by the `status` envelope. There is no dedicated welcome
 * message — the server emits this after accepting the hello, then begins streaming.
 *
 * `homeDir` is the daemon host's home directory (`os.homedir()`), the authoritative value clients
 * expand a `~`-prefixed `cwd`/path against. It is the daemon's home, not the client's: a browser on
 * macOS may drive a Linux daemon (or vice versa), so a client MUST never derive it locally.
 * Optional only for wire compatibility with daemons predating it — a client that gets no value
 * leaves tilde paths unexpanded rather than guessing.
 */
export const serverInfoPayloadSchema = z.object({
  status: z.literal("server_info"),
  serverId: z.string(),
  hostname: z.string().optional(),
  version: z.string().optional(),
  homeDir: z.string().optional(),
  capabilities: z.record(z.string(), z.unknown()),
  features: z.record(z.string(), z.unknown()),
});
export type ServerInfoPayload = z.infer<typeof serverInfoPayloadSchema>;

/** Server → Client status envelope wrapping `server_info`. */
export const statusSchema = z.object({
  type: z.literal("status"),
  payload: serverInfoPayloadSchema,
});
export type Status = z.infer<typeof statusSchema>;

// ===========================================================================
// Liveness (JSON ping/pong, NOT RFC6455 ping — browsers/RN cannot access protocol ping)
// ===========================================================================

export const pingSchema = z.object({
  type: z.literal("ping"),
  requestId: z.string(),
  clientSentAt: wireTimestampSchema.optional(),
});
export type Ping = z.infer<typeof pingSchema>;

export const pongSchema = z.object({
  type: z.literal("pong"),
  requestId: z.string(),
  clientSentAt: wireTimestampSchema.optional(),
  serverReceivedAt: wireTimestampSchema,
  serverSentAt: wireTimestampSchema,
});
export type Pong = z.infer<typeof pongSchema>;

// ===========================================================================
// RPC naming convention
// ===========================================================================

export type RpcDirection = "request" | "response";

/**
 * Builds a dotted RPC name: `domain.provider.operation.direction`
 * (e.g. `checkout.github.set_auto_merge.request`). Segments read left→right:
 * domain → provider/subsystem → operation (a verb) → direction. New RPCs use this form; legacy
 * flat names (e.g. `checkout_pr_merge_request`) remain *accepted* but must not be generated.
 */
export function rpcName(
  domain: string,
  providerOrSubsystem: string,
  operation: string,
  direction: RpcDirection,
): string {
  return `${domain}.${providerOrSubsystem}.${operation}.${direction}`;
}

// ===========================================================================
// Agent session config (create_agent_request)
// ===========================================================================

/** Status the daemon reports for an agent (architecture/persistence.md — `lastStatus`). */
export const agentStatusEnum = z.enum(["initializing", "idle", "running", "error", "closed"]);
export type AgentStatus = z.infer<typeof agentStatusEnum>;

export const imageAttachmentSchema = z
  .object({ mimeType: z.string().optional(), data: z.string().optional() })
  .passthrough();
export type ImageAttachment = z.infer<typeof imageAttachmentSchema>;

export const agentAttachmentsSchema = z
  .object({
    prs: z.array(z.unknown()).optional(),
    issues: z.array(z.unknown()).optional(),
  })
  .passthrough();

/**
 * `AgentSessionConfig` — provider/mode/model and run options for an agent. `provider`/`modeId`/
 * `model`/`thinkingOptionId` are dynamic strings (discovered at runtime per agent-providers.md),
 * not fixed enums, so they are not narrowed here.
 */
export const agentSessionConfigSchema = z.object({
  provider: z.string(),
  cwd: z.string(),
  modeId: z.string().optional(),
  model: z.string().optional(),
  /** The model's own underlying LLM provider (e.g. `"anthropic"`), pinned alongside `model` when
   * a deferred draft materializes (either the resolved default or an explicit `/model` pick) —
   * required to replay it via `setProviderModel` on first spawn, since neither `createSession`
   * nor `resumeSession` consult this field (Pi resolves its own default at spawn). */
  modelProvider: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  featureValues: z.record(z.string(), z.unknown()).optional(),
  title: z.string().nullable().optional(),
  approvalPolicy: z.string().optional(),
  sandboxMode: z.string().optional(),
  networkAccess: z.boolean().optional(),
  webSearch: z.boolean().optional(),
  extra: z.object({ pi: z.unknown().optional() }).passthrough().optional(),
  systemPrompt: z.string().optional(),
  mcpServers: z.record(z.string(), z.unknown()).optional(),
});
export type AgentSessionConfig = z.infer<typeof agentSessionConfigSchema>;

export const createAgentRequestSchema = z.object({
  type: z.literal("create_agent_request"),
  requestId: z.string(),
  config: agentSessionConfigSchema,
  env: z.record(z.string(), z.string()).optional(),
  workspaceId: z.string().optional(),
  worktreeName: z.string().optional(),
  initialPrompt: z.string().optional(),
  clientMessageId: z.string().optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  images: z.array(imageAttachmentSchema).optional(),
  attachments: agentAttachmentsSchema.optional(),
  git: z.unknown().optional(),
  worktree: z.unknown().optional(),
  autoArchive: z.boolean().optional(),
  labels: z.record(z.string(), z.string()).default({}),
});
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

export const createAgentResponseSchema = z.object({
  type: z.literal("create_agent_response"),
  requestId: z.string(),
  payload: z.object({ agentId: z.string() }).passthrough(),
});
export type CreateAgentResponse = z.infer<typeof createAgentResponseSchema>;

// ===========================================================================
// Agent lifecycle messages
// ===========================================================================

export const agentUpdateSchema = z.object({
  type: z.literal("agent_update"),
  agentId: z.string(),
  status: agentStatusEnum.optional(),
  title: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).optional(),
});

export const agentStatusMessageSchema = z.object({
  type: z.literal("agent_status"),
  agentId: z.string(),
  status: agentStatusEnum,
});

export const agentListSchema = z.object({
  type: z.literal("agent_list"),
  agents: z.array(z.object({ id: z.string() }).passthrough()),
});

export const agentDeletedSchema = z.object({
  type: z.literal("agent_deleted"),
  agentId: z.string(),
});

export const agentArchivedSchema = z.object({
  type: z.literal("agent_archived"),
  agentId: z.string(),
  archivedAt: isoTimestampSchema.optional(),
});

// ===========================================================================
// Tool-call details + stream events
// ===========================================================================

/** `ToolCallDetail` — normalized across providers, discriminated on `kind`. */
export const toolCallDetailSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("shell"),
    command: z.string().optional(),
    output: z.string().optional(),
  }),
  z.object({ kind: z.literal("read"), path: z.string().optional(), output: z.string().optional() }),
  z.object({
    kind: z.literal("edit"),
    path: z.string().optional(),
    diff: z.string().optional(),
    output: z.string().optional(),
  }),
  z.object({
    kind: z.literal("write"),
    path: z.string().optional(),
    output: z.string().optional(),
  }),
  z.object({
    kind: z.literal("search"),
    query: z.string().optional(),
    output: z.string().optional(),
  }),
  z.object({ kind: z.literal("fetch"), url: z.string().optional(), output: z.string().optional() }),
  z.object({
    kind: z.literal("task"),
    description: z.string().optional(),
    output: z.string().optional(),
  }),
]);
export type ToolCallDetail = z.infer<typeof toolCallDetailSchema>;

/** `AgentStreamEvent` — discriminated on `kind`. */
export const agentStreamEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user_message"),
    messageId: z.string().optional(),
    text: z.string().optional(),
    images: z.array(imageAttachmentSchema).optional(),
  }),
  z.object({
    kind: z.literal("assistant_message"),
    messageId: z.string().optional(),
    text: z.string().optional(),
    /**
     * Set on the marker event that closes an assistant text block (Pi's `text_end` delta). The
     * text is complete and will not grow, so a renderer can switch from its cheap streaming tier
     * to full markdown immediately instead of waiting for `turn_completed`, which is one
     * `agent_end` — potentially minutes of tool execution — away. Carries no `text` of its own
     * when emitted as a standalone marker; hydrated history sets it alongside the block's full
     * text. Older clients see an empty `assistant_message` and no-op.
     */
    final: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("reasoning"),
    text: z.string().optional(),
    /** Closes a thinking block (Pi's `thinking_end` delta) — see `assistant_message.final`. */
    final: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("tool_call"),
    callId: z.string().optional(),
    tool: toolCallDetailSchema,
    status: z.string().optional(),
  }),
  z.object({ kind: z.literal("turn_started"), turnId: z.string().optional() }),
  z.object({ kind: z.literal("turn_completed"), turnId: z.string().optional() }),
  z.object({
    kind: z.literal("turn_failed"),
    turnId: z.string().optional(),
    error: z.string().optional(),
  }),
  z.object({ kind: z.literal("turn_canceled"), turnId: z.string().optional() }),
  z.object({ kind: z.literal("error"), message: z.string().optional() }),
  z.object({
    kind: z.literal("queue_update"),
    steering: z.array(z.string()).optional(),
    followUp: z.array(z.string()).optional(),
  }),
]);
export type AgentStreamEvent = z.infer<typeof agentStreamEventSchema>;

export const agentStreamSchema = z.object({
  type: z.literal("agent_stream"),
  agentId: z.string(),
  seq: z.number().optional(),
  timestamp: wireTimestampSchema.optional(),
  event: agentStreamEventSchema,
});

// ===========================================================================
// Timeline fetch (authoritative paged history)
// ===========================================================================

export const timelineDirectionEnum = z.enum(["before", "after"]);
export type TimelineDirection = z.infer<typeof timelineDirectionEnum>;

export const sourceSeqRangeSchema = z.object({ start: z.number(), end: z.number() });
export type SourceSeqRange = z.infer<typeof sourceSeqRangeSchema>;

export const fetchAgentTimelineRequestSchema = z.object({
  type: z.literal("fetch_agent_timeline_request"),
  requestId: z.string(),
  agentId: z.string(),
  cursor: z.string().nullable().optional(),
  direction: timelineDirectionEnum,
  limit: z.number().optional(),
});
export type FetchAgentTimelineRequest = z.infer<typeof fetchAgentTimelineRequestSchema>;

export const fetchAgentTimelineResponseSchema = z.object({
  type: z.literal("fetch_agent_timeline_response"),
  requestId: z.string(),
  agentId: z.string().optional(),
  items: z.array(z.unknown()),
  seqStart: z.number(),
  seqEnd: z.number(),
  sourceSeqRanges: z.array(sourceSeqRangeSchema),
  collapsed: z.boolean(),
  hasNewer: z.boolean(),
  startCursor: z.string().nullable().optional(),
  endCursor: z.string().nullable().optional(),
});
export type FetchAgentTimelineResponse = z.infer<typeof fetchAgentTimelineResponseSchema>;

// ===========================================================================
// Tool-call permissions
// ===========================================================================

export const agentPermissionRequestSchema = z.object({
  type: z.literal("agent_permission_request"),
  requestId: z.string(),
  agentId: z.string(),
  toolName: z.string().optional(),
  tool: toolCallDetailSchema.optional(),
  action: z.unknown().optional(),
  responses: z.array(z.string()).optional(),
});

export const agentPermissionResolvedSchema = z.object({
  type: z.literal("agent_permission_resolved"),
  requestId: z.string(),
  agentId: z.string(),
  decision: z.string().optional(),
});

/** respond-to-permission RPC (client → daemon), dotted name `agent.permission.respond.request`. */
export const respondToPermissionRequestSchema = z.object({
  type: z.literal("agent.permission.respond.request"),
  requestId: z.string(),
  permissionRequestId: z.string(),
  response: z.unknown(),
});

export const respondToPermissionResponseSchema = z.object({
  type: z.literal("agent.permission.respond.response"),
  requestId: z.string(),
  payload: z.object({ resolved: z.boolean() }).passthrough(),
});

/** Legacy flat name for the same operation — still accepted (parsed), never generated. */
export const legacyRespondToPermissionSchema = z.object({
  type: z.literal("respond_to_permission"),
  requestId: z.string(),
  permissionRequestId: z.string(),
  response: z.unknown(),
});

// ===========================================================================
// ===========================================================================
// Rewind RPC (features/rewind.md) — additive, new in sprint-015
// ===========================================================================

export const rewindModeSchema = z.enum(["conversation", "files", "both"]);
export type RewindMode = z.infer<typeof rewindModeSchema>;

export const agentRewindRequestSchema = z
  .object({
    type: z.literal("agent.rewind.request"),
    requestId: z.string(),
    agentId: z.string(),
    messageId: z.string(),
    mode: rewindModeSchema,
  })
  .passthrough();
export type AgentRewindRequest = z.infer<typeof agentRewindRequestSchema>;

export const agentRewindResponseSchema = z
  .object({
    type: z.literal("agent.rewind.response"),
    requestId: z.string(),
    payload: z
      .object({
        agentId: z.string(),
        messageId: z.string(),
        mode: rewindModeSchema,
        truncatedAt: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type AgentRewindResponse = z.infer<typeof agentRewindResponseSchema>;

// ===========================================================================
// Slash-command operations (sprint-037): Pi built-ins with an RPC equivalent —
// /session, /compact, /new, /resume, /fork, /clone, /name, /export, /model, /copy.
// Pi's own RPC docs are explicit that built-in TUI commands without one of these RPC
// equivalents (e.g. /settings, /hotkeys) are never expanded by the `prompt` command and are
// intentionally NOT represented on the wire.
// ===========================================================================

export const agentTokenUsageSchema = z
  .object({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
    total: z.number().optional(),
  })
  .passthrough();
export type AgentTokenUsage = z.infer<typeof agentTokenUsageSchema>;

export const agentContextUsageSchema = z
  .object({
    tokens: z.number().nullable().optional(),
    contextWindow: z.number().optional(),
    percent: z.number().nullable().optional(),
  })
  .passthrough();
export type AgentContextUsage = z.infer<typeof agentContextUsageSchema>;

/** `/session` — mirrors Pi RPC `get_session_stats`. */
export const agentSessionStatsRequestSchema = z
  .object({
    type: z.literal("agent_session_stats_request"),
    requestId: z.string(),
    agentId: z.string(),
  })
  .passthrough();
export type AgentSessionStatsRequest = z.infer<typeof agentSessionStatsRequestSchema>;

export const agentSessionStatsResponseSchema = z
  .object({
    type: z.literal("agent_session_stats_response"),
    requestId: z.string(),
    payload: z
      .object({
        sessionId: z.string().optional(),
        sessionFile: z.string().optional(),
        userMessages: z.number().optional(),
        assistantMessages: z.number().optional(),
        toolCalls: z.number().optional(),
        toolResults: z.number().optional(),
        totalMessages: z.number().optional(),
        tokens: agentTokenUsageSchema.optional(),
        cost: z.number().optional(),
        contextUsage: agentContextUsageSchema.optional(),
        /** Current model id (sprint-042: poll-authoritative source for the web-client status
         * bar's model segment; back-filled server-side when the provider's own stats omit it). */
        model: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type AgentSessionStatsResponse = z.infer<typeof agentSessionStatsResponseSchema>;

/** `/compact` — mirrors Pi RPC `compact`. */
export const agentCompactRequestSchema = z
  .object({
    type: z.literal("agent_compact_request"),
    requestId: z.string(),
    agentId: z.string(),
    customInstructions: z.string().optional(),
  })
  .passthrough();
export type AgentCompactRequest = z.infer<typeof agentCompactRequestSchema>;

export const agentCompactResponseSchema = z
  .object({
    type: z.literal("agent_compact_response"),
    requestId: z.string(),
    payload: z
      .object({
        summary: z.string().optional(),
        firstKeptEntryId: z.string().optional(),
        tokensBefore: z.number().optional(),
        details: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type AgentCompactResponse = z.infer<typeof agentCompactResponseSchema>;

/** `/new` — mirrors Pi RPC `new_session`. */
export const agentNewSessionRequestSchema = z
  .object({
    type: z.literal("agent_new_session_request"),
    requestId: z.string(),
    agentId: z.string(),
  })
  .passthrough();
export type AgentNewSessionRequest = z.infer<typeof agentNewSessionRequestSchema>;

export const agentNewSessionResponseSchema = z
  .object({
    type: z.literal("agent_new_session_response"),
    requestId: z.string(),
    payload: z.object({ cancelled: z.boolean() }).passthrough(),
  })
  .passthrough();
export type AgentNewSessionResponse = z.infer<typeof agentNewSessionResponseSchema>;

/** `/resume` — mirrors Pi RPC `switch_session`. */
export const agentSwitchSessionRequestSchema = z
  .object({
    type: z.literal("agent_switch_session_request"),
    requestId: z.string(),
    agentId: z.string(),
    sessionPath: z.string(),
  })
  .passthrough();
export type AgentSwitchSessionRequest = z.infer<typeof agentSwitchSessionRequestSchema>;

export const agentSwitchSessionResponseSchema = z
  .object({
    type: z.literal("agent_switch_session_response"),
    requestId: z.string(),
    payload: z.object({ cancelled: z.boolean() }).passthrough(),
  })
  .passthrough();
export type AgentSwitchSessionResponse = z.infer<typeof agentSwitchSessionResponseSchema>;

/** `/fork` — mirrors Pi RPC `fork`. */
export const agentForkRequestSchema = z
  .object({
    type: z.literal("agent_fork_request"),
    requestId: z.string(),
    agentId: z.string(),
    entryId: z.string(),
  })
  .passthrough();
export type AgentForkRequest = z.infer<typeof agentForkRequestSchema>;

export const agentForkResponseSchema = z
  .object({
    type: z.literal("agent_fork_response"),
    requestId: z.string(),
    payload: z.object({ text: z.string(), cancelled: z.boolean() }).passthrough(),
  })
  .passthrough();
export type AgentForkResponse = z.infer<typeof agentForkResponseSchema>;

/** Fork picker — mirrors Pi RPC `get_fork_messages`. */
export const agentForkMessagesRequestSchema = z
  .object({
    type: z.literal("agent_fork_messages_request"),
    requestId: z.string(),
    agentId: z.string(),
  })
  .passthrough();
export type AgentForkMessagesRequest = z.infer<typeof agentForkMessagesRequestSchema>;

export const agentForkMessagesResponseSchema = z
  .object({
    type: z.literal("agent_fork_messages_response"),
    requestId: z.string(),
    payload: z
      .object({
        messages: z.array(z.object({ entryId: z.string(), text: z.string() }).passthrough()),
      })
      .passthrough(),
  })
  .passthrough();
export type AgentForkMessagesResponse = z.infer<typeof agentForkMessagesResponseSchema>;

/** `/clone` — mirrors Pi RPC `clone`. */
export const agentCloneRequestSchema = z
  .object({
    type: z.literal("agent_clone_request"),
    requestId: z.string(),
    agentId: z.string(),
  })
  .passthrough();
export type AgentCloneRequest = z.infer<typeof agentCloneRequestSchema>;

export const agentCloneResponseSchema = z
  .object({
    type: z.literal("agent_clone_response"),
    requestId: z.string(),
    payload: z.object({ cancelled: z.boolean() }).passthrough(),
  })
  .passthrough();
export type AgentCloneResponse = z.infer<typeof agentCloneResponseSchema>;

/** `/name` — mirrors Pi RPC `set_session_name`. */
export const agentSetSessionNameRequestSchema = z
  .object({
    type: z.literal("agent_set_session_name_request"),
    requestId: z.string(),
    agentId: z.string(),
    name: z.string(),
  })
  .passthrough();
export type AgentSetSessionNameRequest = z.infer<typeof agentSetSessionNameRequestSchema>;

export const agentSetSessionNameResponseSchema = z
  .object({
    type: z.literal("agent_set_session_name_response"),
    requestId: z.string(),
    payload: z.object({}).passthrough().optional(),
  })
  .passthrough();
export type AgentSetSessionNameResponse = z.infer<typeof agentSetSessionNameResponseSchema>;

/** `/export` — mirrors Pi RPC `export_html`. */
export const agentExportHtmlRequestSchema = z
  .object({
    type: z.literal("agent_export_html_request"),
    requestId: z.string(),
    agentId: z.string(),
    outputPath: z.string().optional(),
  })
  .passthrough();
export type AgentExportHtmlRequest = z.infer<typeof agentExportHtmlRequestSchema>;

export const agentExportHtmlResponseSchema = z
  .object({
    type: z.literal("agent_export_html_response"),
    requestId: z.string(),
    payload: z.object({ path: z.string() }).passthrough(),
  })
  .passthrough();
export type AgentExportHtmlResponse = z.infer<typeof agentExportHtmlResponseSchema>;

/** `/model` (set) — mirrors Pi RPC `set_model`. Model payload shape varies by provider. */
export const agentSetModelRequestSchema = z
  .object({
    type: z.literal("agent_set_model_request"),
    requestId: z.string(),
    agentId: z.string(),
    provider: z.string(),
    modelId: z.string(),
  })
  .passthrough();
export type AgentSetModelRequest = z.infer<typeof agentSetModelRequestSchema>;

export const agentSetModelResponseSchema = z
  .object({
    type: z.literal("agent_set_model_response"),
    requestId: z.string(),
    payload: z.object({}).passthrough(),
  })
  .passthrough();
export type AgentSetModelResponse = z.infer<typeof agentSetModelResponseSchema>;

/** `/model` (cycle) — mirrors Pi RPC `cycle_model`. */
export const agentCycleModelRequestSchema = z
  .object({
    type: z.literal("agent_cycle_model_request"),
    requestId: z.string(),
    agentId: z.string(),
  })
  .passthrough();
export type AgentCycleModelRequest = z.infer<typeof agentCycleModelRequestSchema>;

export const agentCycleModelResponseSchema = z
  .object({
    type: z.literal("agent_cycle_model_response"),
    requestId: z.string(),
    payload: z
      .object({
        model: z.unknown().nullable().optional(),
        thinkingLevel: z.string().optional(),
        isScoped: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type AgentCycleModelResponse = z.infer<typeof agentCycleModelResponseSchema>;
/** Thinking level (set) — sprint-070. `level` is a dynamic string (per-model discovery), not an
 * enum, matching `agentSessionConfigSchema.thinkingOptionId`'s convention. The response's
 * `payload.level` is the EFFECTIVE (possibly Pi-clamped) level, never the requested one. */
export const agentSetThinkingRequestSchema = z
  .object({
    type: z.literal("agent_set_thinking_request"),
    requestId: z.string(),
    agentId: z.string(),
    level: z.string(),
  })
  .passthrough();
export type AgentSetThinkingRequest = z.infer<typeof agentSetThinkingRequestSchema>;

export const agentSetThinkingResponseSchema = z
  .object({
    type: z.literal("agent_set_thinking_response"),
    requestId: z.string(),
    payload: z
      .object({
        agentId: z.string(),
        /** Effective level after provider clamping. */
        level: z.string(),
      })
      .passthrough(),
  })
  .passthrough();
export type AgentSetThinkingResponse = z.infer<typeof agentSetThinkingResponseSchema>;

/** Thinking levels (list) — sprint-070. Live sessions only; drafts answer from the model
 * catalogue client-side (features/thinking-level-selector.md § Level discovery). */
export const agentThinkingLevelsRequestSchema = z
  .object({
    type: z.literal("agent_thinking_levels_request"),
    requestId: z.string(),
    agentId: z.string(),
  })
  .passthrough();
export type AgentThinkingLevelsRequest = z.infer<typeof agentThinkingLevelsRequestSchema>;

export const agentThinkingLevelsResponseSchema = z
  .object({
    type: z.literal("agent_thinking_levels_response"),
    requestId: z.string(),
    payload: z
      .object({
        agentId: z.string(),
        levels: z.array(z.string()),
      })
      .passthrough(),
  })
  .passthrough();
export type AgentThinkingLevelsResponse = z.infer<typeof agentThinkingLevelsResponseSchema>;

/** `/copy` — mirrors Pi RPC `get_last_assistant_text`. */
export const agentLastAssistantTextRequestSchema = z
  .object({
    type: z.literal("agent_last_assistant_text_request"),
    requestId: z.string(),
    agentId: z.string(),
  })
  .passthrough();
export type AgentLastAssistantTextRequest = z.infer<typeof agentLastAssistantTextRequestSchema>;

export const agentLastAssistantTextResponseSchema = z
  .object({
    type: z.literal("agent_last_assistant_text_response"),
    requestId: z.string(),
    payload: z.object({ text: z.string().nullable() }).passthrough(),
  })
  .passthrough();
export type AgentLastAssistantTextResponse = z.infer<typeof agentLastAssistantTextResponseSchema>;

// ===========================================================================
// Steering (steer_agent / follow_up_agent) — inject a message into a LIVE turn
// (Pi RPC `steer` / `follow_up`, docs/rpc.md). Fire-and-forget like interrupt_agent:
// does not start a new turn or change agent status. Delivery is confirmed by a
// `queue_update` stream event, not by the response payload.
// ===========================================================================

export const steerAgentRequestSchema = z
  .object({
    type: z.literal("steer_agent_request"),
    requestId: z.string(),
    agentId: z.string(),
    message: z.string(),
    images: z.array(imageAttachmentSchema).optional(),
    clientMessageId: z.string().optional(),
  })
  .passthrough();
export type SteerAgentRequest = z.infer<typeof steerAgentRequestSchema>;

export const steerAgentResponseSchema = z
  .object({
    type: z.literal("steer_agent_response"),
    requestId: z.string(),
    agentId: z.string(),
    ok: z.boolean(),
  })
  .passthrough();
export type SteerAgentResponse = z.infer<typeof steerAgentResponseSchema>;

export const followUpAgentRequestSchema = z
  .object({
    type: z.literal("follow_up_agent_request"),
    requestId: z.string(),
    agentId: z.string(),
    message: z.string(),
    images: z.array(imageAttachmentSchema).optional(),
    clientMessageId: z.string().optional(),
  })
  .passthrough();
export type FollowUpAgentRequest = z.infer<typeof followUpAgentRequestSchema>;

export const followUpAgentResponseSchema = z
  .object({
    type: z.literal("follow_up_agent_response"),
    requestId: z.string(),
    agentId: z.string(),
    ok: z.boolean(),
  })
  .passthrough();
export type FollowUpAgentResponse = z.infer<typeof followUpAgentResponseSchema>;

// ===========================================================================
// Command discovery (agent_list_commands) — surfaces Pi's `get_commands`: user/project-authored
// extension commands (`pi.registerCommand()`), prompt templates (`.pi/agent/prompts/*.md`), and
// skills (`.pi/agent/skills/<name>/SKILL.md`). Disjoint from the built-in slash-command RPCs above
// (Pi's own structured commands are never returned by `get_commands`). Read-only, session-scoped.
// ===========================================================================

export const agentCommandDescriptorSchema = z
  .object({
    name: z.string(),
    id: z.string().optional(),
    description: z.string().optional(),
    source: z.enum(["extension", "prompt", "skill"]).optional(),
    scope: z.enum(["user", "project", "temporary"]).optional(),
    path: z.string().optional(),
  })
  .passthrough();
export type AgentCommandDescriptor = z.infer<typeof agentCommandDescriptorSchema>;

/** Surfaces Pi's `get_commands` RPC: extension/prompt/skill discovery for a live session. */
export const agentListCommandsRequestSchema = z
  .object({
    type: z.literal("agent_list_commands_request"),
    requestId: z.string(),
    agentId: z.string(),
  })
  .passthrough();
export type AgentListCommandsRequest = z.infer<typeof agentListCommandsRequestSchema>;

export const agentListCommandsResponseSchema = z
  .object({
    type: z.literal("agent_list_commands_response"),
    requestId: z.string(),
    payload: z
      .object({
        commands: z.array(agentCommandDescriptorSchema),
      })
      .passthrough(),
  })
  .passthrough();
export type AgentListCommandsResponse = z.infer<typeof agentListCommandsResponseSchema>;

// ===========================================================================
// Extension packs (sprint-057, sprint-056 preinstalled-extensions.md § RPC surface) — read curated-
// pack state and change the selection over the wire. No push/broadcast type: sync is
// request-triggered and the response carries the result (the `checkout_status_update` per-session
// `send()` family is the precedent to copy if live progress is ever wanted, not a new mechanism).
// ===========================================================================

/**
 * Documents today's values for `EntryInfo.status`. Structurally mirrors
 * `packages/server/src/extensions/sync-planner.ts`'s `EntryStatus` — duplicated deliberately
 * (protocol keeps zero workspace imports, root invariant 2); task-003 maps between them. The wire
 * field itself is `z.string()`, never a narrowed enum: an older client must still parse a status
 * value a later daemon introduces (append-only rule).
 */
export type EntryStatus =
  | "installed"
  | "pending"
  | "failed"
  | "user_removed"
  | "user_modified"
  | "deprecated";

/**
 * Documents today's values for `SyncReport.outcome` / `lastSync.outcome`. The wire field is
 * `z.string()` for the same forward-compat reason as {@link EntryStatus} — the server already
 * commits to this for the persisted form (`ExtensionsDescribe.lastSync.outcome`,
 * `packages/server/src/extensions/extensions-service.ts`), since a persisted future outcome must
 * round-trip through an older daemon.
 */
export type SyncOutcome = "ok" | "noop" | "partial" | "failed" | "skipped";

export const extensionEntryInfoSchema = z
  .object({
    source: z.string(),
    identity: z.string(),
    addedIn: z.string(),
    deprecated: z.boolean().optional(),
    /** {@link EntryStatus} today; plain string on the wire (see above). */
    status: z.string(),
    lastError: z
      .object({
        at: z.string(),
        attempts: z.number(),
        /** `ExtensionFailureReason` today (`sync-executor.ts`); plain string, same reason. */
        reason: z.string(),
        message: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ExtensionEntryInfo = z.infer<typeof extensionEntryInfoSchema>;

export const extensionPackInfoSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    packages: z.array(extensionEntryInfoSchema),
  })
  .passthrough();
export type ExtensionPackInfo = z.infer<typeof extensionPackInfoSchema>;

/** One failed install within a triggered sync run. */
export const extensionSyncFailureSchema = z
  .object({
    identity: z.string(),
    source: z.string(),
    pack: z.string(),
    /** `ExtensionFailureReason` today; plain string, same forward-compat reason as above. */
    reason: z.string(),
    message: z.string(),
  })
  .passthrough();

/** The full result of a triggered sync run — returned only as an RPC response field, never
 *  persisted as-is (see {@link extensionsLastSyncSummarySchema}). */
export const extensionSyncReportSchema = z
  .object({
    at: z.string(),
    /** {@link SyncOutcome} today; plain string on the wire. */
    outcome: z.string(),
    installed: z.array(z.string()),
    failures: z.array(extensionSyncFailureSchema),
  })
  .passthrough();
export type ExtensionSyncReport = z.infer<typeof extensionSyncReportSchema>;

/**
 * `lastSync` is a **summary**, not a report: only `{ at, outcome }` is ever persisted
 * (`extensions-state.json`), so promising a full {@link ExtensionSyncReport} here would be a lie
 * after any daemon restart. No `installed`/`failures` fields — do not widen this to the report shape.
 */
export const extensionsLastSyncSummarySchema = z
  .object({
    at: z.string(),
    /** {@link SyncOutcome} today; plain string on the wire. */
    outcome: z.string(),
  })
  .passthrough();

export const extensionPacksListRequestSchema = z
  .object({
    type: z.literal("extension_packs_list_request"),
    requestId: z.string(),
  })
  .passthrough();
export type ExtensionPacksListRequest = z.infer<typeof extensionPacksListRequestSchema>;

export const extensionPacksListResponseSchema = z
  .object({
    type: z.literal("extension_packs_list_response"),
    requestId: z.string(),
    autoSync: z.boolean(),
    selected: z.array(z.string()),
    packs: z.array(extensionPackInfoSchema),
    lastSync: extensionsLastSyncSummarySchema.optional(),
  })
  .passthrough();
export type ExtensionPacksListResponse = z.infer<typeof extensionPacksListResponseSchema>;

/**
 * `packs` is optional; its **absence** is the manual-sync trigger. Present ⇒ change the selection
 * and sync. Absent ⇒ change nothing, run an ungated manual sync — this is what carries
 * `pi-studio extensions sync` (task-005), which must keep working even with `autoSync: false`.
 */
export const extensionPacksSetRequestSchema = z
  .object({
    type: z.literal("extension_packs_set_request"),
    requestId: z.string(),
    packs: z.array(z.string()).optional(),
  })
  .passthrough();
export type ExtensionPacksSetRequest = z.infer<typeof extensionPacksSetRequestSchema>;

/**
 * `ok`/`error` are domain fields, not `rpc_error` — a handler cannot express a domain failure
 * (e.g. an unknown pack slug) through `rpc_error`, which carries only transport-level codes
 * (mirrors `file_watch_subscribe_response`'s `ok: false, error: "…"` idiom). `report` is optional
 * for the same reason: a rejected request ran no sync.
 */
export const extensionPacksSetResponseSchema = z
  .object({
    type: z.literal("extension_packs_set_response"),
    requestId: z.string(),
    autoSync: z.boolean(),
    selected: z.array(z.string()),
    packs: z.array(extensionPackInfoSchema),
    lastSync: extensionsLastSyncSummarySchema.optional(),
    ok: z.boolean(),
    error: z.string().optional(),
    report: extensionSyncReportSchema.optional(),
  })
  .passthrough();
export type ExtensionPacksSetResponse = z.infer<typeof extensionPacksSetResponseSchema>;

// ===========================================================================
// Provider auth (sprint-055, features/provider-auth-rpc.md) — remote-driven Pi login flows.
// Five request/response pairs get real schemas + union membership (durable, multi-client RPC
// surface). The per-session progress push, `provider_auth_flow_event`, is deliberately NOT a
// union member — like `checkout_status_update`/`file_changed`, it rides
// `sessionMessageBaseSchema`'s passthrough fallback. Do not "fix" that by adding a schema for it.
//
// Every response requires `ok`; a domain failure is `{ ok: false, error: "<reason>" }` in the
// payload, never a chosen `rpc_error` code (`ws/router.ts` only emits `unknown_message_type` /
// `handler_error`, both reserved for transport-level failures).
// ===========================================================================

export const providerAuthTypeSchema = z.enum(["api_key", "oauth"]);
export type ProviderAuthType = z.infer<typeof providerAuthTypeSchema>;

/** One provider's auth capability + current state (`configured: "unknown"` = a bounded
 *  `checkAuth()` timed out — see sprint-054's `checkAuthBounded` precedent). */
export const providerAuthInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    authTypes: z.array(providerAuthTypeSchema),
    oauthLoginLabel: z.string().optional(),
    oauthIsSubscription: z.boolean().optional(),
    configured: z.union([z.boolean(), z.literal("unknown")]),
    configuredType: providerAuthTypeSchema.optional(),
    configuredSource: z.string().optional(),
  })
  .passthrough();
export type ProviderAuthInfo = z.infer<typeof providerAuthInfoSchema>;

export const providerAuthListRequestSchema = z
  .object({
    type: z.literal("provider_auth_list_request"),
    requestId: z.string(),
  })
  .passthrough();
export type ProviderAuthListRequest = z.infer<typeof providerAuthListRequestSchema>;

export const providerAuthListResponseSchema = z
  .object({
    type: z.literal("provider_auth_list_response"),
    requestId: z.string(),
    payload: z
      .object({
        ok: z.boolean(),
        providers: z.array(providerAuthInfoSchema).default([]),
        error: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type ProviderAuthListResponse = z.infer<typeof providerAuthListResponseSchema>;

export const providerAuthLoginRequestSchema = z
  .object({
    type: z.literal("provider_auth_login_request"),
    requestId: z.string(),
    provider: z.string(),
    authType: providerAuthTypeSchema,
  })
  .passthrough();
export type ProviderAuthLoginRequest = z.infer<typeof providerAuthLoginRequestSchema>;

export const providerAuthLoginResponseSchema = z
  .object({
    type: z.literal("provider_auth_login_response"),
    requestId: z.string(),
    payload: z
      .object({
        ok: z.boolean(),
        flowId: z.string().optional(),
        error: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type ProviderAuthLoginResponse = z.infer<typeof providerAuthLoginResponseSchema>;

export const providerAuthRespondRequestSchema = z
  .object({
    type: z.literal("provider_auth_respond_request"),
    requestId: z.string(),
    flowId: z.string(),
    promptId: z.string(),
    value: z.string(),
  })
  .passthrough();
export type ProviderAuthRespondRequest = z.infer<typeof providerAuthRespondRequestSchema>;

export const providerAuthRespondResponseSchema = z
  .object({
    type: z.literal("provider_auth_respond_response"),
    requestId: z.string(),
    payload: z
      .object({
        ok: z.boolean(),
        error: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type ProviderAuthRespondResponse = z.infer<typeof providerAuthRespondResponseSchema>;

export const providerAuthCancelRequestSchema = z
  .object({
    type: z.literal("provider_auth_cancel_request"),
    requestId: z.string(),
    flowId: z.string(),
  })
  .passthrough();
export type ProviderAuthCancelRequest = z.infer<typeof providerAuthCancelRequestSchema>;

/** Idempotent — `ok: true` even when the named flow was already gone. */
export const providerAuthCancelResponseSchema = z
  .object({
    type: z.literal("provider_auth_cancel_response"),
    requestId: z.string(),
    payload: z.object({ ok: z.boolean() }).passthrough(),
  })
  .passthrough();
export type ProviderAuthCancelResponse = z.infer<typeof providerAuthCancelResponseSchema>;

export const providerAuthLogoutRequestSchema = z
  .object({
    type: z.literal("provider_auth_logout_request"),
    requestId: z.string(),
    provider: z.string(),
  })
  .passthrough();
export type ProviderAuthLogoutRequest = z.infer<typeof providerAuthLogoutRequestSchema>;

/** `stillConfigured` flags an ambient credential (e.g. an env var) surviving the logout. */
export const providerAuthLogoutResponseSchema = z
  .object({
    type: z.literal("provider_auth_logout_response"),
    requestId: z.string(),
    payload: z
      .object({
        ok: z.boolean(),
        stillConfigured: z.boolean().optional(),
        error: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type ProviderAuthLogoutResponse = z.infer<typeof providerAuthLogoutResponseSchema>;

// ===========================================================================
// Extension UI (features/extension-ui-rpc.md) — additive, new in sprint-066
// ===========================================================================

/**
 * A pending extension-UI dialog awaiting a client answer (list/reconnect-catch-up shape). Method
 * semantics (which fields `payload` carries, how to render it) are entirely Pi's business — the
 * daemon never interprets `payload`, only correlates and forwards it.
 */
export const agentUiPendingRequestSchema = z
  .object({
    requestId: z.string(),
    agentId: z.string(),
    method: z.string(),
    expectsResponse: z.boolean(),
    payload: z.record(z.unknown()),
    surfaceKey: z.string().optional(),
    timeoutMs: z.number().optional(),
    createdAt: wireTimestampSchema,
  })
  .passthrough();
export type AgentUiPendingRequest = z.infer<typeof agentUiPendingRequestSchema>;

/**
 * A retained, last-value-wins extension-UI surface (status line, widget, title). Deleted (not
 * listed) once its owning method sends a clearing update — see `agent_ui_request.removed`.
 */
export const agentUiSurfaceSchema = z
  .object({
    agentId: z.string(),
    method: z.string(),
    surfaceKey: z.string(),
    payload: z.record(z.unknown()),
    updatedAt: wireTimestampSchema,
  })
  .passthrough();
export type AgentUiSurface = z.infer<typeof agentUiSurfaceSchema>;

/**
 * Agent-scoped broadcast to every client — one per provider UI event, exactly like
 * `agentPermissionRequestSchema`, not the `sessionMessageBaseSchema` passthrough family (this is a
 * per-agent broadcast, not a per-session subscription push). `requestId` is daemon-minted, never the
 * provider's own id. `removed: true` marks a surface-clearing update (no `payload` fields to render).
 */
export const agentUiRequestSchema = z
  .object({
    type: z.literal("agent_ui_request"),
    requestId: z.string(),
    agentId: z.string(),
    method: z.string(),
    expectsResponse: z.boolean(),
    payload: z.record(z.unknown()),
    surfaceKey: z.string().optional(),
    removed: z.boolean().optional(),
    timeoutMs: z.number().optional(),
    createdAt: wireTimestampSchema,
  })
  .passthrough();
export type AgentUiRequest = z.infer<typeof agentUiRequestSchema>;

/**
 * Broadcast that lets every client dismiss a dialog once it is no longer answerable. `reason` is
 * deliberately an open string (`answered` | `cancelled` | `timeout` | `aborted` documented, not
 * enumerated) so the daemon can extend its taxonomy without narrowing the wire for older clients.
 */
export const agentUiResolvedSchema = z
  .object({
    type: z.literal("agent_ui_resolved"),
    requestId: z.string(),
    agentId: z.string(),
    reason: z.string(),
  })
  .passthrough();
export type AgentUiResolved = z.infer<typeof agentUiResolvedSchema>;

/**
 * The answer body forwarded to the provider. Deliberately permissive (every field optional,
 * `.passthrough()`): method → response-shape validation is Pi's business, and a strict union keyed
 * on `method` would reject a shape a future Pi UI method introduces, blocking that extension forever
 * on a response the daemon refused to forward.
 */
export const agentUiResponseSchema = z
  .object({
    value: z.string().optional(),
    confirmed: z.boolean().optional(),
    cancelled: z.boolean().optional(),
  })
  .passthrough();
export type AgentUiResponse = z.infer<typeof agentUiResponseSchema>;

export const agentUiRespondRequestSchema = z
  .object({
    type: z.literal("agent_ui_respond_request"),
    requestId: z.string(),
    uiRequestId: z.string(),
    response: agentUiResponseSchema,
  })
  .passthrough();
export type AgentUiRespondRequest = z.infer<typeof agentUiRespondRequestSchema>;

/** `error` is an open string (`not_found` | `unsupported` documented, not enumerated). */
export const agentUiRespondResponseSchema = z
  .object({
    type: z.literal("agent_ui_respond_response"),
    requestId: z.string(),
    payload: z
      .object({
        ok: z.boolean(),
        error: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type AgentUiRespondResponse = z.infer<typeof agentUiRespondResponseSchema>;

/** Reconnect catch-up: list current pending dialogs + retained surfaces, all agents or one. */
export const agentUiListRequestSchema = z
  .object({
    type: z.literal("agent_ui_list_request"),
    requestId: z.string(),
    agentId: z.string().optional(),
  })
  .passthrough();
export type AgentUiListRequest = z.infer<typeof agentUiListRequestSchema>;

export const agentUiListResponseSchema = z
  .object({
    type: z.literal("agent_ui_list_response"),
    requestId: z.string(),
    payload: z
      .object({
        ok: z.boolean(),
        pending: z.array(agentUiPendingRequestSchema),
        surfaces: z.array(agentUiSurfaceSchema),
        error: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type AgentUiListResponse = z.infer<typeof agentUiListResponseSchema>;

// ===========================================================================
// RPC error
// ===========================================================================

export const rpcErrorSchema = z.object({
  type: z.literal("rpc_error"),
  requestId: z.string(),
  code: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type RpcError = z.infer<typeof rpcErrorSchema>;

// ===========================================================================
// Session message union (agent / timeline / permission core)
// ===========================================================================

/**
 * The discriminated union of session messages defined so far. Later feature sprints extend this
 * union with workspace/git/terminal/chat/schedule/loop families.
 */
export const sessionMessageSchema = z.discriminatedUnion("type", [
  createAgentRequestSchema,
  createAgentResponseSchema,
  agentUpdateSchema,
  agentStatusMessageSchema,
  agentListSchema,
  agentDeletedSchema,
  agentArchivedSchema,
  agentStreamSchema,
  fetchAgentTimelineRequestSchema,
  fetchAgentTimelineResponseSchema,
  agentPermissionRequestSchema,
  agentPermissionResolvedSchema,
  respondToPermissionRequestSchema,
  respondToPermissionResponseSchema,
  legacyRespondToPermissionSchema,
  agentRewindRequestSchema,
  agentRewindResponseSchema,
  agentSessionStatsRequestSchema,
  agentSessionStatsResponseSchema,
  agentCompactRequestSchema,
  agentCompactResponseSchema,
  agentNewSessionRequestSchema,
  agentNewSessionResponseSchema,
  agentSwitchSessionRequestSchema,
  agentSwitchSessionResponseSchema,
  agentForkRequestSchema,
  agentForkResponseSchema,
  agentForkMessagesRequestSchema,
  agentForkMessagesResponseSchema,
  agentCloneRequestSchema,
  agentCloneResponseSchema,
  agentSetSessionNameRequestSchema,
  agentSetSessionNameResponseSchema,
  agentExportHtmlRequestSchema,
  agentExportHtmlResponseSchema,
  agentSetModelRequestSchema,
  agentSetModelResponseSchema,
  agentCycleModelRequestSchema,
  agentCycleModelResponseSchema,
  agentSetThinkingRequestSchema,
  agentSetThinkingResponseSchema,
  agentThinkingLevelsRequestSchema,
  agentThinkingLevelsResponseSchema,
  agentLastAssistantTextRequestSchema,
  agentLastAssistantTextResponseSchema,
  steerAgentRequestSchema,
  steerAgentResponseSchema,
  followUpAgentRequestSchema,
  followUpAgentResponseSchema,
  agentListCommandsRequestSchema,
  agentListCommandsResponseSchema,
  extensionPacksListRequestSchema,
  extensionPacksListResponseSchema,
  extensionPacksSetRequestSchema,
  extensionPacksSetResponseSchema,
  providerAuthListRequestSchema,
  providerAuthListResponseSchema,
  providerAuthLoginRequestSchema,
  providerAuthLoginResponseSchema,
  providerAuthRespondRequestSchema,
  providerAuthRespondResponseSchema,
  providerAuthCancelRequestSchema,
  providerAuthCancelResponseSchema,
  providerAuthLogoutRequestSchema,
  providerAuthLogoutResponseSchema,
  agentUiRequestSchema,
  agentUiResolvedSchema,
  agentUiRespondRequestSchema,
  agentUiRespondResponseSchema,
  agentUiListRequestSchema,
  agentUiListResponseSchema,
  rpcErrorSchema,
]);
export type SessionMessage = z.infer<typeof sessionMessageSchema>;

/**
 * Structural fallback for any session message (carries a `type` discriminant). Unknown/future
 * session types still parse here (append-only / "ignore unknown type per handler policy"), so the
 * envelope accepts them and handlers validate per-family with the specific schema above.
 */
export const sessionMessageBaseSchema = z.object({ type: z.string() }).passthrough();
export type SessionMessageBase = z.infer<typeof sessionMessageBaseSchema>;

// ===========================================================================
// Session envelope + top-level union
// ===========================================================================

/**
 * Envelope wrapping the rich session message union. Known message types validate strictly against
 * `sessionMessageSchema`; unknown/future types fall back to the structural base so an older client
 * still parses newer messages.
 */
export const sessionEnvelopeSchema = z.object({
  type: z.literal("session"),
  message: z.union([sessionMessageSchema, sessionMessageBaseSchema]),
});
export type SessionEnvelope = z.infer<typeof sessionEnvelopeSchema>;

/** Discriminated union of all top-level envelopes, keyed by `type`. */
export const topLevelEnvelopeSchema = z.discriminatedUnion("type", [
  helloSchema,
  statusSchema,
  pingSchema,
  pongSchema,
  sessionEnvelopeSchema,
]);
export type TopLevelEnvelope = z.infer<typeof topLevelEnvelopeSchema>;
