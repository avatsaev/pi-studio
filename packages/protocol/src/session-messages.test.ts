import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  agentCloneResponseSchema,
  agentCompactRequestSchema,
  agentCompactResponseSchema,
  agentCycleModelResponseSchema,
  agentExportHtmlRequestSchema,
  agentExportHtmlResponseSchema,
  agentForkMessagesResponseSchema,
  agentForkRequestSchema,
  agentForkResponseSchema,
  agentLastAssistantTextResponseSchema,
  agentListCommandsRequestSchema,
  agentListCommandsResponseSchema,
  agentNewSessionResponseSchema,
  agentSessionStatsRequestSchema,
  agentSessionStatsResponseSchema,
  agentSetModelRequestSchema,
  agentSetSessionNameRequestSchema,
  agentSetThinkingRequestSchema,
  agentSetThinkingResponseSchema,
  agentThinkingLevelsRequestSchema,
  agentThinkingLevelsResponseSchema,
  agentStatusMessageSchema,
  agentStreamEventSchema,
  agentSwitchSessionRequestSchema,
  agentUiListRequestSchema,
  agentUiListResponseSchema,
  agentUiPendingRequestSchema,
  agentUiRequestSchema,
  agentUiResolvedSchema,
  agentUiRespondRequestSchema,
  agentUiRespondResponseSchema,
  agentUiResponseSchema,
  agentUiSurfaceSchema,
  createAgentRequestSchema,
  extensionPacksListRequestSchema,
  extensionPacksListResponseSchema,
  extensionPacksSetRequestSchema,
  extensionPacksSetResponseSchema,
  fetchAgentTimelineResponseSchema,
  legacyRespondToPermissionSchema,
  providerAuthCancelRequestSchema,
  providerAuthCancelResponseSchema,
  providerAuthInfoSchema,
  providerAuthListRequestSchema,
  providerAuthListResponseSchema,
  providerAuthLoginRequestSchema,
  providerAuthLoginResponseSchema,
  providerAuthLogoutRequestSchema,
  providerAuthLogoutResponseSchema,
  providerAuthRespondRequestSchema,
  providerAuthRespondResponseSchema,
  respondToPermissionRequestSchema,
  respondToPermissionResponseSchema,
  rpcErrorSchema,
  rpcName,
  sessionEnvelopeSchema,
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
      expect(toolCallDetailSchema.safeParse({ kind, output: "some result text" }).success).toBe(
        true,
      );
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

  it("agent_session_stats_response accepts an optional model (sprint-042)", () => {
    const withModel = agentSessionStatsResponseSchema.safeParse({
      type: "agent_session_stats_response",
      requestId: "r1",
      payload: { model: "claude-opus-4" },
    });
    expect(withModel.success).toBe(true);
    const withoutModel = agentSessionStatsResponseSchema.safeParse({
      type: "agent_session_stats_response",
      requestId: "r1",
      payload: {},
    });
    expect(withoutModel.success).toBe(true);
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
  it("agent_set_thinking round-trips and requires agentId + level", () => {
    expect(
      agentSetThinkingRequestSchema.safeParse({
        type: "agent_set_thinking_request",
        requestId: "r1",
        agentId: "a1",
        level: "high",
      }).success,
    ).toBe(true);
    expect(
      agentSetThinkingRequestSchema.safeParse({
        type: "agent_set_thinking_request",
        requestId: "r1",
        agentId: "a1",
      }).success,
    ).toBe(false);
    expect(
      agentSetThinkingResponseSchema.safeParse({
        type: "agent_set_thinking_response",
        requestId: "r1",
        payload: { agentId: "a1", level: "off" },
      }).success,
    ).toBe(true);
  });

  it("agent_thinking_levels round-trips with a levels array", () => {
    expect(
      agentThinkingLevelsRequestSchema.safeParse({
        type: "agent_thinking_levels_request",
        requestId: "r1",
        agentId: "a1",
      }).success,
    ).toBe(true);
    expect(
      agentThinkingLevelsResponseSchema.safeParse({
        type: "agent_thinking_levels_response",
        requestId: "r1",
        payload: { agentId: "a1", levels: ["off", "low", "medium", "high"] },
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
      agent_list_commands_request: { agentId: "a1" },
      agent_list_commands_response: { payload: { commands: [] } },
      agent_set_thinking_request: { agentId: "a1", level: "high" },
      agent_set_thinking_response: { payload: { agentId: "a1", level: "high" } },
      agent_thinking_levels_request: { agentId: "a1" },
      agent_thinking_levels_response: { payload: { agentId: "a1", levels: ["off"] } },
    };
    for (const [type, extra] of Object.entries(messages)) {
      const result = sessionMessageSchema.safeParse({ type, requestId: "r1", ...extra });
      expect(result.success, `${type} should parse`).toBe(true);
    }
  });
});

describe("command discovery (sprint-040)", () => {
  it("requires agentId on agent_list_commands_request", () => {
    expect(
      agentListCommandsRequestSchema.safeParse({
        type: "agent_list_commands_request",
        requestId: "r1",
      }).success,
    ).toBe(false);
    expect(
      agentListCommandsRequestSchema.safeParse({
        type: "agent_list_commands_request",
        requestId: "r1",
        agentId: "a1",
      }).success,
    ).toBe(true);
  });

  it("accepts a populated commands array covering every field kind", () => {
    const result = agentListCommandsResponseSchema.safeParse({
      type: "agent_list_commands_response",
      requestId: "r1",
      payload: {
        commands: [
          {
            name: "review",
            id: "review",
            description: "Run a code review extension command",
            source: "extension",
            scope: "project",
            path: ".pi/agent/extensions/review.ts",
          },
          { name: "standup" },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("tolerates unknown extra fields on command entries and the payload (passthrough)", () => {
    const result = agentListCommandsResponseSchema.safeParse({
      type: "agent_list_commands_response",
      requestId: "r1",
      payload: {
        commands: [{ name: "ship", fromTheFuture: true }],
        fromTheFutureToo: 1,
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("extension packs (sprint-057)", () => {
  const pack = {
    id: "core",
    title: "Core",
    description: "Curated core pack",
    packages: [
      { source: "npm:pi-memctx", identity: "npm:pi-memctx", addedIn: "0.0.1", status: "installed" },
    ],
  };

  it("extension_packs_list_request/_response parse with a lastSync-absent response", () => {
    expect(
      extensionPacksListRequestSchema.safeParse({
        type: "extension_packs_list_request",
        requestId: "r1",
      }).success,
    ).toBe(true);

    const result = extensionPacksListResponseSchema.safeParse({
      type: "extension_packs_list_response",
      requestId: "r1",
      autoSync: true,
      selected: ["core"],
      packs: [pack],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.lastSync).toBeUndefined();
  });

  it("lastSync accepts exactly { at, outcome } as a summary, never installed/failures", () => {
    const result = extensionPacksListResponseSchema.safeParse({
      type: "extension_packs_list_response",
      requestId: "r1",
      autoSync: true,
      selected: [],
      packs: [],
      lastSync: { at: "2026-08-13T00:00:00.000Z", outcome: "ok" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastSync).toEqual({ at: "2026-08-13T00:00:00.000Z", outcome: "ok" });
      expect(result.data.lastSync).not.toHaveProperty("installed");
      expect(result.data.lastSync).not.toHaveProperty("failures");
    }
  });

  it("tolerates an unknown future EntryInfo.status, SyncReport failure reason, and lastSync outcome", () => {
    const futureEntry = {
      ...pack,
      packages: [{ ...pack.packages[0], status: "quarantined_future" }],
    };
    expect(
      extensionPacksListResponseSchema.safeParse({
        type: "extension_packs_list_response",
        requestId: "r1",
        autoSync: true,
        selected: [],
        packs: [futureEntry],
        lastSync: { at: "2026-08-13T00:00:00.000Z", outcome: "reconciled_future" },
      }).success,
    ).toBe(true);

    const setResult = extensionPacksSetResponseSchema.safeParse({
      type: "extension_packs_set_response",
      requestId: "r1",
      autoSync: true,
      selected: ["core"],
      packs: [pack],
      ok: true,
      report: {
        at: "2026-08-13T00:00:00.000Z",
        outcome: "reconciled_future",
        installed: [],
        failures: [
          {
            identity: "npm:pi-memctx",
            source: "npm:pi-memctx",
            pack: "core",
            reason: "quantum_flux",
            message: "boom",
          },
        ],
      },
    });
    expect(setResult.success).toBe(true);
  });

  it("extension_packs_set_request validates with and without packs (manual-sync trigger)", () => {
    expect(
      extensionPacksSetRequestSchema.safeParse({
        type: "extension_packs_set_request",
        requestId: "r1",
        packs: ["core"],
      }).success,
    ).toBe(true);
    const manual = extensionPacksSetRequestSchema.safeParse({
      type: "extension_packs_set_request",
      requestId: "r1",
    });
    expect(manual.success).toBe(true);
    if (manual.success) expect(manual.data.packs).toBeUndefined();
  });

  it("extension_packs_set_response: ok:false + error validates without report; ok:true validates with report", () => {
    const rejected = extensionPacksSetResponseSchema.safeParse({
      type: "extension_packs_set_response",
      requestId: "r1",
      autoSync: true,
      selected: [],
      packs: [pack],
      ok: false,
      error: "unknown pack slug: nope",
    });
    expect(rejected.success).toBe(true);
    if (rejected.success) expect(rejected.data.report).toBeUndefined();

    const accepted = extensionPacksSetResponseSchema.safeParse({
      type: "extension_packs_set_response",
      requestId: "r1",
      autoSync: true,
      selected: ["core"],
      packs: [pack],
      ok: true,
      report: {
        at: "2026-08-13T00:00:00.000Z",
        outcome: "ok",
        installed: ["npm:pi-memctx"],
        failures: [],
      },
    });
    expect(accepted.success).toBe(true);
  });

  it("parses both pairs through the session-message union", () => {
    expect(
      sessionMessageSchema.safeParse({ type: "extension_packs_list_request", requestId: "r1" })
        .success,
    ).toBe(true);
    expect(
      sessionMessageSchema.safeParse({
        type: "extension_packs_set_request",
        requestId: "r1",
        packs: ["core"],
      }).success,
    ).toBe(true);
  });
});

describe("provider auth (sprint-055)", () => {
  it("all five request/response pairs parse through the session-message union", () => {
    const cases: Record<string, unknown> = {
      provider_auth_list_request: { type: "provider_auth_list_request", requestId: "r1" },
      provider_auth_list_response: {
        type: "provider_auth_list_response",
        requestId: "r1",
        payload: { ok: true, providers: [] },
      },
      provider_auth_login_request: {
        type: "provider_auth_login_request",
        requestId: "r1",
        provider: "openai",
        authType: "api_key",
      },
      provider_auth_login_response: {
        type: "provider_auth_login_response",
        requestId: "r1",
        payload: { ok: true, flowId: "f1" },
      },
      provider_auth_respond_request: {
        type: "provider_auth_respond_request",
        requestId: "r1",
        flowId: "f1",
        promptId: "p1",
        value: "sk-test",
      },
      provider_auth_respond_response: {
        type: "provider_auth_respond_response",
        requestId: "r1",
        payload: { ok: true },
      },
      provider_auth_cancel_request: {
        type: "provider_auth_cancel_request",
        requestId: "r1",
        flowId: "f1",
      },
      provider_auth_cancel_response: {
        type: "provider_auth_cancel_response",
        requestId: "r1",
        payload: { ok: true },
      },
      provider_auth_logout_request: {
        type: "provider_auth_logout_request",
        requestId: "r1",
        provider: "openai",
      },
      provider_auth_logout_response: {
        type: "provider_auth_logout_response",
        requestId: "r1",
        payload: { ok: true },
      },
    };
    for (const [type, message] of Object.entries(cases)) {
      const result = sessionMessageSchema.safeParse(message);
      expect(result.success, `${type} should parse`).toBe(true);
    }
  });

  it("every response payload requires ok — missing ok fails validation", () => {
    const responseSchemas = [
      providerAuthListResponseSchema,
      providerAuthLoginResponseSchema,
      providerAuthRespondResponseSchema,
      providerAuthCancelResponseSchema,
      providerAuthLogoutResponseSchema,
    ] as const;
    const bases: Record<string, unknown> = {
      provider_auth_list_response: {},
      provider_auth_login_response: {},
      provider_auth_respond_response: {},
      provider_auth_cancel_response: {},
      provider_auth_logout_response: {},
    };
    for (const schema of responseSchemas) {
      const type = (schema.shape.type as z.ZodLiteral<string>).value;
      const missingOk = schema.safeParse({
        type,
        requestId: "r1",
        payload: bases[type],
      });
      expect(missingOk.success, `${type} without ok should fail`).toBe(false);

      const withOk = schema.safeParse({
        type,
        requestId: "r1",
        payload: { ...(bases[type] as object), ok: false, error: "boom" },
      });
      expect(withOk.success, `${type} with ok should pass`).toBe(true);
    }
  });

  it('providerAuthInfoSchema accepts configured: true/false/"unknown" and rejects other values', () => {
    const base = { id: "openai", name: "OpenAI", authTypes: ["api_key"] as const };
    expect(providerAuthInfoSchema.safeParse({ ...base, configured: true }).success).toBe(true);
    expect(providerAuthInfoSchema.safeParse({ ...base, configured: false }).success).toBe(true);
    expect(providerAuthInfoSchema.safeParse({ ...base, configured: "unknown" }).success).toBe(true);
    expect(providerAuthInfoSchema.safeParse({ ...base, configured: "yes" }).success).toBe(false);
    expect(providerAuthInfoSchema.safeParse({ ...base, configured: 1 }).success).toBe(false);
  });

  it("unknown extra fields survive a parse round-trip on every new schema (passthrough)", () => {
    const schemas = [
      [providerAuthListRequestSchema, { type: "provider_auth_list_request", requestId: "r1" }],
      [
        providerAuthListResponseSchema,
        {
          type: "provider_auth_list_response",
          requestId: "r1",
          payload: { ok: true, providers: [] },
        },
      ],
      [
        providerAuthLoginRequestSchema,
        {
          type: "provider_auth_login_request",
          requestId: "r1",
          provider: "openai",
          authType: "api_key",
        },
      ],
      [
        providerAuthLoginResponseSchema,
        { type: "provider_auth_login_response", requestId: "r1", payload: { ok: true } },
      ],
      [
        providerAuthRespondRequestSchema,
        {
          type: "provider_auth_respond_request",
          requestId: "r1",
          flowId: "f1",
          promptId: "p1",
          value: "v",
        },
      ],
      [
        providerAuthRespondResponseSchema,
        { type: "provider_auth_respond_response", requestId: "r1", payload: { ok: true } },
      ],
      [
        providerAuthCancelRequestSchema,
        { type: "provider_auth_cancel_request", requestId: "r1", flowId: "f1" },
      ],
      [
        providerAuthCancelResponseSchema,
        { type: "provider_auth_cancel_response", requestId: "r1", payload: { ok: true } },
      ],
      [
        providerAuthLogoutRequestSchema,
        { type: "provider_auth_logout_request", requestId: "r1", provider: "openai" },
      ],
      [
        providerAuthLogoutResponseSchema,
        { type: "provider_auth_logout_response", requestId: "r1", payload: { ok: true } },
      ],
    ] as const;
    for (const [schema, message] of schemas) {
      const result = schema.safeParse({ ...message, fromTheFuture: "kept" });
      expect(result.success, `${message.type} should parse with an unknown field`).toBe(true);
      if (result.success) {
        expect((result.data as Record<string, unknown>).fromTheFuture).toBe("kept");
      }
    }
  });

  it("provider_auth_flow_event validates through the session envelope via the passthrough fallback, not a union entry", () => {
    // Deliberately NOT in `sessionMessageSchema` — this proves the passthrough fallback covers it.
    expect(
      sessionMessageSchema.safeParse({
        type: "provider_auth_flow_event",
        flowId: "f1",
        event: { kind: "info", message: "hi" },
      }).success,
    ).toBe(false);

    const envelope = sessionEnvelopeSchema.safeParse({
      type: "session",
      message: {
        type: "provider_auth_flow_event",
        flowId: "f1",
        event: { kind: "info", message: "hi" },
      },
    });
    expect(envelope.success).toBe(true);
  });
});

describe("extension UI (sprint-066)", () => {
  const baseRequest = {
    type: "agent_ui_request",
    requestId: "wire-1",
    agentId: "a1",
    method: "confirm",
    expectsResponse: true,
    payload: { message: "Proceed?" },
    createdAt: 1_700_000_000_000,
  };

  it("all six message types parse through the session-message union", () => {
    const cases: Record<string, unknown> = {
      agent_ui_request: baseRequest,
      agent_ui_resolved: {
        type: "agent_ui_resolved",
        requestId: "wire-1",
        agentId: "a1",
        reason: "answered",
      },
      agent_ui_respond_request: {
        type: "agent_ui_respond_request",
        requestId: "r1",
        uiRequestId: "wire-1",
        response: { confirmed: true },
      },
      agent_ui_respond_response: {
        type: "agent_ui_respond_response",
        requestId: "r1",
        payload: { ok: true },
      },
      agent_ui_list_request: { type: "agent_ui_list_request", requestId: "r1" },
      agent_ui_list_response: {
        type: "agent_ui_list_response",
        requestId: "r1",
        payload: { ok: true, pending: [], surfaces: [] },
      },
    };
    for (const [type, message] of Object.entries(cases)) {
      const result = sessionMessageSchema.safeParse(message);
      expect(result.success, `${type} should parse`).toBe(true);
    }
  });

  it("both response schemas require ok under payload — missing ok fails validation", () => {
    const missingOk = agentUiRespondResponseSchema.safeParse({
      type: "agent_ui_respond_response",
      requestId: "r1",
      payload: {},
    });
    expect(missingOk.success).toBe(false);

    const withOk = agentUiRespondResponseSchema.safeParse({
      type: "agent_ui_respond_response",
      requestId: "r1",
      payload: { ok: false, error: "not_found" },
    });
    expect(withOk.success).toBe(true);

    const listMissingOk = agentUiListResponseSchema.safeParse({
      type: "agent_ui_list_response",
      requestId: "r1",
      payload: { pending: [], surfaces: [] },
    });
    expect(listMissingOk.success).toBe(false);

    const listWithOk = agentUiListResponseSchema.safeParse({
      type: "agent_ui_list_response",
      requestId: "r1",
      payload: { ok: true, pending: [], surfaces: [] },
    });
    expect(listWithOk.success).toBe(true);
  });

  it("agent_ui_request validates with surfaceKey/removed/timeoutMs all absent, and with all three present", () => {
    expect(agentUiRequestSchema.safeParse(baseRequest).success).toBe(true);
    expect(
      agentUiRequestSchema.safeParse({
        ...baseRequest,
        surfaceKey: "status:build",
        removed: false,
        timeoutMs: 30_000,
      }).success,
    ).toBe(true);
  });

  it("createdAt/updatedAt accept both an epoch-ms number and an ISO string", () => {
    expect(
      agentUiRequestSchema.safeParse({ ...baseRequest, createdAt: 1_700_000_000_000 }).success,
    ).toBe(true);
    expect(
      agentUiRequestSchema.safeParse({ ...baseRequest, createdAt: "2026-08-20T00:00:00.000Z" })
        .success,
    ).toBe(true);

    const surface = {
      agentId: "a1",
      method: "setStatus",
      surfaceKey: "status:build",
      payload: { text: "building" },
    };
    expect(
      agentUiSurfaceSchema.safeParse({ ...surface, updatedAt: 1_700_000_000_000 }).success,
    ).toBe(true);
    expect(
      agentUiSurfaceSchema.safeParse({ ...surface, updatedAt: "2026-08-20T00:00:00.000Z" }).success,
    ).toBe(true);
  });

  it("payload accepts an arbitrary nested record and survives a parse round-trip byte-for-byte", () => {
    const nested = { message: "Proceed?", meta: { nested: { deep: [1, 2, { a: "b" }] } } };
    const result = agentUiRequestSchema.safeParse({ ...baseRequest, payload: nested });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload).toEqual(nested);
    }

    const pendingResult = agentUiPendingRequestSchema.safeParse({
      requestId: "wire-1",
      agentId: "a1",
      method: "confirm",
      expectsResponse: true,
      payload: nested,
      createdAt: 1_700_000_000_000,
    });
    expect(pendingResult.success).toBe(true);
    if (pendingResult.success) {
      expect(pendingResult.data.payload).toEqual(nested);
    }
  });

  it("agentUiResponseSchema accepts {}, {value}, {confirmed}, {cancelled}, and an unknown extra field", () => {
    expect(agentUiResponseSchema.safeParse({}).success).toBe(true);
    expect(agentUiResponseSchema.safeParse({ value: "hello" }).success).toBe(true);
    expect(agentUiResponseSchema.safeParse({ confirmed: true }).success).toBe(true);
    expect(agentUiResponseSchema.safeParse({ cancelled: true }).success).toBe(true);
    const withExtra = agentUiResponseSchema.safeParse({ fromTheFuture: "kept" });
    expect(withExtra.success).toBe(true);
    if (withExtra.success) {
      expect((withExtra.data as Record<string, unknown>).fromTheFuture).toBe("kept");
    }
  });

  it("reason and error accept an undocumented string value (open-string rule)", () => {
    expect(
      agentUiResolvedSchema.safeParse({
        type: "agent_ui_resolved",
        requestId: "wire-1",
        agentId: "a1",
        reason: "some-future-reason",
      }).success,
    ).toBe(true);
    expect(
      agentUiRespondResponseSchema.safeParse({
        type: "agent_ui_respond_response",
        requestId: "r1",
        payload: { ok: false, error: "some-future-error" },
      }).success,
    ).toBe(true);
  });

  it("unknown extra fields survive a parse round-trip on every new schema (passthrough)", () => {
    const schemas = [
      [agentUiRequestSchema, baseRequest],
      [
        agentUiResolvedSchema,
        { type: "agent_ui_resolved", requestId: "wire-1", agentId: "a1", reason: "answered" },
      ],
      [
        agentUiRespondRequestSchema,
        {
          type: "agent_ui_respond_request",
          requestId: "r1",
          uiRequestId: "wire-1",
          response: {},
        },
      ],
      [
        agentUiRespondResponseSchema,
        { type: "agent_ui_respond_response", requestId: "r1", payload: { ok: true } },
      ],
      [agentUiListRequestSchema, { type: "agent_ui_list_request", requestId: "r1" }],
      [
        agentUiListResponseSchema,
        {
          type: "agent_ui_list_response",
          requestId: "r1",
          payload: { ok: true, pending: [], surfaces: [] },
        },
      ],
    ] as const;
    for (const [schema, message] of schemas) {
      const result = schema.safeParse({ ...message, fromTheFuture: "kept" });
      expect(
        result.success,
        `${(message as { type: string }).type} should parse with an unknown field`,
      ).toBe(true);
      if (result.success) {
        expect((result.data as Record<string, unknown>).fromTheFuture).toBe("kept");
      }
    }
  });
});
