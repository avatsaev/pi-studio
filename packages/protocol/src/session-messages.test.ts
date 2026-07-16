import { describe, expect, it } from "vitest";

import {
  agentStreamEventSchema,
  agentStatusMessageSchema,
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
