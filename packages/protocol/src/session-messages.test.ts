import { describe, expect, it } from "vitest";

import {
  agentCloneRequestSchema,
  agentCloneResponseSchema,
  agentCompactRequestSchema,
  agentCompactResponseSchema,
  agentCycleModelRequestSchema,
  agentCycleModelResponseSchema,
  agentExportHtmlRequestSchema,
  agentExportHtmlResponseSchema,
  agentForkMessagesRequestSchema,
  agentForkMessagesResponseSchema,
  agentForkRequestSchema,
  agentForkResponseSchema,
  agentLastAssistantTextRequestSchema,
  agentLastAssistantTextResponseSchema,
  agentNewSessionRequestSchema,
  agentNewSessionResponseSchema,
  agentSessionStatsRequestSchema,
  agentSessionStatsResponseSchema,
  agentSetModelRequestSchema,
  agentSetModelResponseSchema,
  agentSetSessionNameRequestSchema,
  agentSetSessionNameResponseSchema,
  agentStatusMessageSchema,
  agentStreamEventSchema,
  agentSwitchSessionRequestSchema,
  agentSwitchSessionResponseSchema,
  createAgentRequestSchema,
  fetchAgentTimelineResponseSchema,
  legacyRespondToPermissionSchema,
  respondToPermissionRequestSchema,
  respondToPermissionResponseSchema,
  rpcErrorSchema,
  rpcName,
  sessionMessageSchema,
  toolCallDetailSchema,
} from "./messages.js";

describe("create_agent_request", () => {
  const fullConfig = {
    provider: "pi",
    cwd: "/work/repo",
    modeId: "default",
    model: "claude",
    thinkingOptionId: "medium",
    featureValues: { webSearch: true },
    title: "My agent",
    approvalPolicy: "ask",
    sandboxMode: "workspace-write",
    networkAccess: false,
    webSearch: true,
    extra: { pi: { foo: 1 } },
    systemPrompt: "be nice",
    mcpServers: {},
  };

  it("validates a full AgentSessionConfig", () => {
    const result = createAgentRequestSchema.safeParse({
      type: "create_agent_request",
      requestId: "r1",
      config: fullConfig,
      initialPrompt: "go",
    });
    expect(result.success).toBe(true);
    // labels defaults to {}
    if (result.success) expect(result.data.labels).toEqual({});
  });

  it("rejects a config missing required provider/cwd", () => {
    expect(
      createAgentRequestSchema.safeParse({
        type: "create_agent_request",
        requestId: "r1",
        config: { cwd: "/x" },
      }).success,
    ).toBe(false);
    expect(
      createAgentRequestSchema.safeParse({
        type: "create_agent_request",
        requestId: "r1",
        config: { provider: "pi" },
      }).success,
    ).toBe(false);
  });

  it("rejects bad enum values (agent status)", () => {
    expect(
      agentStatusMessageSchema.safeParse({ type: "agent_status", agentId: "a", status: "idle" })
        .success,
    ).toBe(true);
    expect(
      agentStatusMessageSchema.safeParse({ type: "agent_status", agentId: "a", status: "bogus" })
        .success,
    ).toBe(false);
  });
});

describe("fetch_agent_timeline_response paging fields", () => {
  it("carries all paging fields", () => {
    const result = fetchAgentTimelineResponseSchema.safeParse({
      type: "fetch_agent_timeline_response",
      requestId: "r1",
      items: [{ any: "row" }],
      seqStart: 1,
      seqEnd: 10,
      sourceSeqRanges: [{ start: 1, end: 10 }],
      collapsed: false,
      hasNewer: true,
      startCursor: "c0",
      endCursor: "c10",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when a paging field is missing", () => {
    expect(
      fetchAgentTimelineResponseSchema.safeParse({
        type: "fetch_agent_timeline_response",
        requestId: "r1",
        items: [],
        seqStart: 1,
        seqEnd: 10,
        // sourceSeqRanges missing
        collapsed: false,
        hasNewer: false,
      }).success,
    ).toBe(false);
  });
});

describe("AgentStreamEvent + ToolCallDetail discrimination", () => {
  it("discriminates stream event kinds", () => {
    for (const kind of [
      "user_message",
      "assistant_message",
      "reasoning",
      "turn_started",
      "turn_completed",
      "turn_canceled",
      "error",
    ]) {
      expect(agentStreamEventSchema.safeParse({ kind }).success).toBe(true);
    }
    expect(agentStreamEventSchema.safeParse({ kind: "not_an_event" }).success).toBe(false);
  });

  it("requires a tool detail for tool_call events", () => {
    expect(
      agentStreamEventSchema.safeParse({
        kind: "tool_call",
        tool: { kind: "shell", command: "ls" },
      }).success,
    ).toBe(true);
    expect(agentStreamEventSchema.safeParse({ kind: "tool_call" }).success).toBe(false);
  });

  it("discriminates tool-call kinds and rejects unknown ones", () => {
    for (const kind of ["shell", "read", "edit", "write", "search", "fetch", "task"]) {
      expect(toolCallDetailSchema.safeParse({ kind }).success).toBe(true);
    }
    expect(toolCallDetailSchema.safeParse({ kind: "telepathy" }).success).toBe(false);
  });

  it("accepts an optional output field on every tool-call kind", () => {
    for (const kind of ["shell", "read", "edit", "write", "search", "fetch", "task"]) {
      expect(toolCallDetailSchema.safeParse({ kind, output: "some result text" }).success).toBe(true);
    }
  });
});

describe("dotted RPC naming + legacy flat names", () => {
  it("builds dotted RPC names", () => {
    expect(rpcName("checkout", "github", "set_auto_merge", "request")).toBe(
      "checkout.github.set_auto_merge.request",
    );
    expect(rpcName("agent", "permission", "respond", "response")).toBe(
      "agent.permission.respond.response",
    );
  });

  it("correlates a dotted request and its .response by requestId", () => {
    const req = respondToPermissionRequestSchema.parse({
      type: "agent.permission.respond.request",
      requestId: "req-9",
      permissionRequestId: "perm-1",
      response: { decision: "allow" },
    });
    const res = respondToPermissionResponseSchema.parse({
      type: "agent.permission.respond.response",
      requestId: "req-9",
      payload: { resolved: true },
    });
    expect(req.requestId).toBe(res.requestId);
  });

  it("still parses a legacy flat name", () => {
    expect(
      legacyRespondToPermissionSchema.safeParse({
        type: "respond_to_permission",
        requestId: "r1",
        permissionRequestId: "perm-1",
        response: "deny",
      }).success,
    ).toBe(true);
  });
});

describe("rpc_error", () => {
  it("carries requestId", () => {
    expect(rpcErrorSchema.safeParse({ type: "rpc_error", requestId: "r1" }).success).toBe(true);
    expect(rpcErrorSchema.safeParse({ type: "rpc_error" }).success).toBe(false);
  });
});

describe("session message union", () => {
  it("dispatches all defined families and rejects unknown types", () => {
    expect(sessionMessageSchema.safeParse({ type: "agent_deleted", agentId: "a" }).success).toBe(
      true,
    );
    expect(sessionMessageSchema.safeParse({ type: "never_seen" }).success).toBe(false);
  });
});

describe("slash-command operations (sprint-037)", () => {
  it("accepts a full agent_session_stats_response and tolerates unknown extra fields", () => {
    const result = agentSessionStatsResponseSchema.safeParse({
      type: "agent_session_stats_response",
      requestId: "r1",
      payload: {
        sessionId: "s1",
        tokens: { input: 100, output: 50, total: 150 },
        contextUsage: { tokens: 500, contextWindow: 200000, percent: 0.25 },
        fromTheFuture: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it("requires agentId on agent_session_stats_request", () => {
    expect(
      agentSessionStatsRequestSchema.safeParse({
        type: "agent_session_stats_request",
        requestId: "r1",
      }).success,
    ).toBe(false);
  });

  it("accepts optional customInstructions on agent_compact_request", () => {
    expect(
      agentCompactRequestSchema.safeParse({
        type: "agent_compact_request",
        requestId: "r1",
        agentId: "a1",
      }).success,
    ).toBe(true);
    expect(
      agentCompactRequestSchema.safeParse({
        type: "agent_compact_request",
        requestId: "r1",
        agentId: "a1",
        customInstructions: "focus on code",
      }).success,
    ).toBe(true);
  });

  it("agent_compact_response carries summary + tokensBefore", () => {
    const result = agentCompactResponseSchema.safeParse({
      type: "agent_compact_response",
      requestId: "r1",
      payload: { summary: "did stuff", firstKeptEntryId: "e1", tokensBefore: 150000 },
    });
    expect(result.success).toBe(true);
  });

  it("agent_new_session_response carries cancelled", () => {
    expect(
      agentNewSessionResponseSchema.safeParse({
        type: "agent_new_session_response",
        requestId: "r1",
        payload: { cancelled: false },
      }).success,
    ).toBe(true);
  });

  it("agent_switch_session_request requires sessionPath", () => {
    expect(
      agentSwitchSessionRequestSchema.safeParse({
        type: "agent_switch_session_request",
        requestId: "r1",
        agentId: "a1",
      }).success,
    ).toBe(false);
    expect(
      agentSwitchSessionRequestSchema.safeParse({
        type: "agent_switch_session_request",
        requestId: "r1",
        agentId: "a1",
        sessionPath: "/tmp/s.jsonl",
      }).success,
    ).toBe(true);
  });

  it("agent_fork_request requires entryId; agent_fork_response carries text+cancelled", () => {
    expect(
      agentForkRequestSchema.safeParse({
        type: "agent_fork_request",
        requestId: "r1",
        agentId: "a1",
        entryId: "e1",
      }).success,
    ).toBe(true);
    expect(
      agentForkResponseSchema.safeParse({
        type: "agent_fork_response",
        requestId: "r1",
        payload: { text: "original prompt", cancelled: false },
      }).success,
    ).toBe(true);
  });

  it("agent_fork_messages_response carries a list of entryId/text pairs", () => {
    const result = agentForkMessagesResponseSchema.safeParse({
      type: "agent_fork_messages_response",
      requestId: "r1",
      payload: { messages: [{ entryId: "e1", text: "first" }] },
    });
    expect(result.success).toBe(true);
  });

  it("agent_clone_response carries cancelled", () => {
    expect(
      agentCloneResponseSchema.safeParse({
        type: "agent_clone_response",
        requestId: "r1",
        payload: { cancelled: false },
      }).success,
    ).toBe(true);
  });

  it("agent_set_session_name_request requires name", () => {
    expect(
      agentSetSessionNameRequestSchema.safeParse({
        type: "agent_set_session_name_request",
        requestId: "r1",
        agentId: "a1",
      }).success,
    ).toBe(false);
    expect(
      agentSetSessionNameRequestSchema.safeParse({
        type: "agent_set_session_name_request",
        requestId: "r1",
        agentId: "a1",
        name: "my-feature-work",
      }).success,
    ).toBe(true);
  });

  it("agent_export_html_response carries a path; outputPath is optional on the request", () => {
    expect(
      agentExportHtmlRequestSchema.safeParse({
        type: "agent_export_html_request",
        requestId: "r1",
        agentId: "a1",
      }).success,
    ).toBe(true);
    expect(
      agentExportHtmlResponseSchema.safeParse({
        type: "agent_export_html_response",
        requestId: "r1",
        payload: { path: "/tmp/session.html" },
      }).success,
    ).toBe(true);
  });

  it("agent_set_model_request requires provider + modelId", () => {
    expect(
      agentSetModelRequestSchema.safeParse({
        type: "agent_set_model_request",
        requestId: "r1",
        agentId: "a1",
        provider: "anthropic",
      }).success,
    ).toBe(false);
    expect(
      agentSetModelRequestSchema.safeParse({
        type: "agent_set_model_request",
        requestId: "r1",
        agentId: "a1",
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
      }).success,
    ).toBe(true);
  });

  it("agent_cycle_model_response allows a null model (single-model case)", () => {
    expect(
      agentCycleModelResponseSchema.safeParse({
        type: "agent_cycle_model_response",
        requestId: "r1",
        payload: { model: null },
      }).success,
    ).toBe(true);
  });

  it("agent_last_assistant_text_response allows a null text", () => {
    expect(
      agentLastAssistantTextResponseSchema.safeParse({
        type: "agent_last_assistant_text_response",
        requestId: "r1",
        payload: { text: null },
      }).success,
    ).toBe(true);
  });

  it("registers every new type in the session message union", () => {
    const messages: Record<string, unknown> = {
      agent_session_stats_request: { agentId: "a1" },
      agent_session_stats_response: { payload: {} },
      agent_compact_request: { agentId: "a1" },
      agent_compact_response: { payload: {} },
      agent_new_session_request: { agentId: "a1" },
      agent_new_session_response: { payload: { cancelled: false } },
      agent_switch_session_request: { agentId: "a1", sessionPath: "/tmp/s.jsonl" },
      agent_switch_session_response: { payload: { cancelled: false } },
      agent_fork_request: { agentId: "a1", entryId: "e1" },
      agent_fork_response: { payload: { text: "x", cancelled: false } },
      agent_fork_messages_request: { agentId: "a1" },
      agent_fork_messages_response: { payload: { messages: [] } },
      agent_clone_request: { agentId: "a1" },
      agent_clone_response: { payload: { cancelled: false } },
      agent_set_session_name_request: { agentId: "a1", name: "n" },
      agent_set_session_name_response: {},
      agent_export_html_request: { agentId: "a1" },
      agent_export_html_response: { payload: { path: "/tmp/s.html" } },
      agent_set_model_request: { agentId: "a1", provider: "anthropic", modelId: "m1" },
      agent_set_model_response: { payload: {} },
      agent_cycle_model_request: { agentId: "a1" },
      agent_cycle_model_response: { payload: {} },
      agent_last_assistant_text_request: { agentId: "a1" },
      agent_last_assistant_text_response: { payload: { text: null } },
    };
    for (const [type, extra] of Object.entries(messages)) {
      const result = sessionMessageSchema.safeParse({ type, requestId: "r1", ...extra });
      expect(result.success, `${type} should parse`).toBe(true);
    }
  });
});
