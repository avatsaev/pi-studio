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
 */
export const serverInfoPayloadSchema = z.object({
  status: z.literal("server_info"),
  serverId: z.string(),
  hostname: z.string().optional(),
  version: z.string().optional(),
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
  z.object({ kind: z.literal("shell"), command: z.string().optional(), output: z.string().optional() }),
  z.object({ kind: z.literal("read"), path: z.string().optional(), output: z.string().optional() }),
  z.object({
    kind: z.literal("edit"),
    path: z.string().optional(),
    diff: z.string().optional(),
    output: z.string().optional(),
  }),
  z.object({ kind: z.literal("write"), path: z.string().optional(), output: z.string().optional() }),
  z.object({ kind: z.literal("search"), query: z.string().optional(), output: z.string().optional() }),
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
  }),
  z.object({ kind: z.literal("reasoning"), text: z.string().optional() }),
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

export const agentRewindRequestSchema = z.object({
  type: z.literal("agent.rewind.request"),
  requestId: z.string(),
  agentId: z.string(),
  messageId: z.string(),
  mode: rewindModeSchema,
}).passthrough();
export type AgentRewindRequest = z.infer<typeof agentRewindRequestSchema>;

export const agentRewindResponseSchema = z.object({
  type: z.literal("agent.rewind.response"),
  requestId: z.string(),
  payload: z.object({
    agentId: z.string(),
    messageId: z.string(),
    mode: rewindModeSchema,
    truncatedAt: z.string().optional(),
  }).passthrough(),
}).passthrough();
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
export type AgentLastAssistantTextResponse = z.infer<
  typeof agentLastAssistantTextResponseSchema
>;

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
  agentLastAssistantTextRequestSchema,
  agentLastAssistantTextResponseSchema,
  steerAgentRequestSchema,
  steerAgentResponseSchema,
  followUpAgentRequestSchema,
  followUpAgentResponseSchema,
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
