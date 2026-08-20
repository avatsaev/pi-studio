import { readFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PARENT_AGENT_ID_LABEL } from "./agent-manager.js";
import { AgentUiService } from "./agent-ui/agent-ui-service.js";
import { McpServer, MCP_SERVER_KEY, type McpBackend } from "./mcp-server.js";
import type { AgentSession, ProviderUiRequest, ProviderUiResponse } from "./provider-contract.js";

function makeBackend(overrides: Partial<McpBackend> = {}): {
  backend: McpBackend;
  created: Array<{ labels: Record<string, string>; notifyOnFinish: boolean }>;
  archived: string[];
} {
  const created: Array<{ labels: Record<string, string>; notifyOnFinish: boolean }> = [];
  const archived: string[] = [];
  const backend: McpBackend = {
    createAgent: async (input) => {
      created.push({ labels: input.labels, notifyOnFinish: input.notifyOnFinish });
      return { agentId: "child-1" };
    },
    sendPrompt: async () => {},
    getStatus: () => ({ status: "idle" }),
    listAgents: () => [{ agentId: "a1", status: "idle" }],
    waitForAgent: async () => ({ status: "idle", timedOut: false }),
    archiveAgent: async (id) => {
      archived.push(id);
    },
    listPendingPermissions: () => [{ requestId: "p1", agentId: "a1", toolName: "bash" }],
    respondToPermission: (requestId) => ({ resolved: requestId === "p1" }),
    listPendingUiRequests: () => [
      {
        requestId: "u1",
        agentId: "a1",
        method: "select",
        expectsResponse: true,
        payload: { question: "which?" },
        createdAt: Date.now(),
      },
    ],
    respondToUiRequest: (requestId) =>
      requestId === "u1" ? { resolved: true } : { resolved: false, error: "unknown_ui_request" },
    listProviders: () => [{ id: "mock" }],
    listModels: () => [{ id: "mock-1" }],
    ...overrides,
  };
  return { backend, created, archived };
}

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-studio-mcp-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("create_agent semantics", () => {
  it("creates an async child, links the parent label, returns its id, notifyOnFinish defaults true", async () => {
    const { backend, created } = makeBackend();
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });
    const result = await mcp.callTool(
      "create_agent",
      { config: { provider: "mock" }, prompt: "hi" },
      {
        callerAgentId: "parent-9",
      },
    );
    expect(result.ok).toBe(true);
    expect(result.agentId).toBe("child-1");
    expect(created[0]!.labels[PARENT_AGENT_ID_LABEL]).toBe("parent-9");
    expect(created[0]!.notifyOnFinish).toBe(true);
  });

  it("detached:true omits the parent label", async () => {
    const { backend, created } = makeBackend();
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });
    const result = await mcp.callTool(
      "create_agent",
      { config: {}, detached: true },
      {
        callerAgentId: "parent-9",
      },
    );
    expect(result.detached).toBe(true);
    expect(created[0]!.labels[PARENT_AGENT_ID_LABEL]).toBeUndefined();
  });
});

describe("wait_for_agent", () => {
  it("returns the terminal status", async () => {
    const { backend } = makeBackend({
      waitForAgent: async () => ({ status: "idle", timedOut: false }),
    });
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });
    const result = await mcp.callTool("wait_for_agent", { agentId: "a1" });
    expect(result).toMatchObject({ ok: true, status: "idle", timedOut: false });
  });

  it("reports timedOut when the agent never finishes", async () => {
    const waitForAgent = vi.fn(async (_id: string, timeoutMs: number) => {
      expect(timeoutMs).toBe(50);
      return { status: "running", timedOut: true };
    });
    const { backend } = makeBackend({ waitForAgent });
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });
    const result = await mcp.callTool("wait_for_agent", { agentId: "a1", timeoutMs: 50 });
    expect(result.timedOut).toBe(true);
  });
});

describe("respond_to_permission", () => {
  it("resolves a pending permission, errors on unknown", async () => {
    const { backend } = makeBackend();
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });
    expect(
      (await mcp.callTool("respond_to_permission", { requestId: "p1", response: "allow" })).ok,
    ).toBe(true);
    const unknown = await mcp.callTool("respond_to_permission", {
      requestId: "nope",
      response: "allow",
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toBe("unknown_permission");
  });
});

describe("extension UI mirror (sprint-066/task-005)", () => {
  it("list_pending_ui_requests returns the backend's pending set", async () => {
    const { backend } = makeBackend();
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });
    const result = await mcp.callTool("list_pending_ui_requests", {});
    expect(result).toMatchObject({ ok: true, requests: [{ requestId: "u1", agentId: "a1" }] });
  });

  it("respond_to_ui_request resolves a pending id, errors unknown_ui_request on a stale one", async () => {
    const { backend } = makeBackend();
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });
    expect(
      (await mcp.callTool("respond_to_ui_request", { requestId: "u1", response: { value: "ok" } }))
        .ok,
    ).toBe(true);
    const unknown = await mcp.callTool("respond_to_ui_request", {
      requestId: "nope",
      response: {},
    });
    expect(unknown).toMatchObject({ ok: false, error: "unknown_ui_request" });
  });

  it("distinguishes unsupported from unknown_ui_request, never collapsing the two", async () => {
    const { backend } = makeBackend({
      respondToUiRequest: () => ({ resolved: false, error: "unsupported" }),
    });
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });
    const result = await mcp.callTool("respond_to_ui_request", { requestId: "u1", response: {} });
    expect(result).toMatchObject({ ok: false, error: "unsupported" });
  });
});

/** The exact delegation a future bootstrap-wiring task must paste into the real `McpBackend`
 *  object: `listPending` directly, `respond` mapped so `unsupported` never collapses into
 *  `unknown_ui_request` (task's own "Notes"). Proven here against the real service, not a fake. */
function backendOver(
  service: AgentUiService,
): Pick<McpBackend, "listPendingUiRequests" | "respondToUiRequest"> {
  return {
    listPendingUiRequests: (agentId) => service.listPending(agentId),
    respondToUiRequest: (requestId, response) => {
      const result = service.respond(requestId, response);
      return { resolved: result.ok, error: result.error };
    },
  };
}

function wireService(): {
  service: AgentUiService;
  fire: (req: ProviderUiRequest) => void;
  calls: unknown[][];
  broadcast: ReturnType<typeof vi.fn>;
} {
  const broadcast = vi.fn();
  const service = new AgentUiService({ broadcast, getActiveSessions: () => [] });
  let cb: ((req: ProviderUiRequest) => void) | undefined;
  const calls: unknown[][] = [];
  const session = {
    onUiRequest(callback: (req: ProviderUiRequest) => void) {
      cb = callback;
      return () => {
        cb = undefined;
      };
    },
    respondToUi(providerRequestId: string, response: ProviderUiResponse) {
      calls.push([providerRequestId, response]);
    },
  } as unknown as AgentSession;
  service.attach("a1", session);
  return { service, fire: (req) => cb?.(req), calls, broadcast };
}

describe("extension UI mirror against a real AgentUiService (sprint-066/task-005)", () => {
  it("mirrors listPending/respond exactly: resolve, receive the answer, broadcast agent_ui_resolved", async () => {
    const { service, fire, calls, broadcast } = wireService();
    fire({ requestId: "p1", method: "select", expectsResponse: true, payload: { q: "which?" } });
    const { backend } = makeBackend(backendOver(service));
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });

    const listed = await mcp.callTool("list_pending_ui_requests", { agentId: "a1" });
    const wireId = (listed.requests as Array<{ requestId: string }>)[0].requestId;

    const result = await mcp.callTool("respond_to_ui_request", {
      requestId: wireId,
      response: { value: "yes" },
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([["p1", { value: "yes" }]]);
    const resolved = broadcast.mock.calls
      .map((c) => (c[1] as { message: Record<string, unknown> }).message)
      .find((m) => m.type === "agent_ui_resolved");
    expect(resolved).toMatchObject({ requestId: wireId, agentId: "a1", reason: "answered" });
  });

  it("a fire-and-forget request was never pending: answering it reports unknown_ui_request", async () => {
    const { service, fire } = wireService();
    fire({ requestId: "p1", method: "notify", expectsResponse: false, payload: {} });
    const { backend } = makeBackend(backendOver(service));
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });
    expect(await mcp.callTool("list_pending_ui_requests", {})).toMatchObject({
      ok: true,
      requests: [],
    });
    const result = await mcp.callTool("respond_to_ui_request", { requestId: "p1", response: {} });
    expect(result).toMatchObject({ ok: false, error: "unknown_ui_request" });
  });

  it("a dialog on a provider without respondToUi reports unsupported, not unknown_ui_request", async () => {
    const broadcast = vi.fn();
    const service = new AgentUiService({ broadcast, getActiveSessions: () => [] });
    let cb: ((req: ProviderUiRequest) => void) | undefined;
    const session = {
      onUiRequest(callback: (req: ProviderUiRequest) => void) {
        cb = callback;
        return () => {};
      },
    } as unknown as AgentSession;
    service.attach("a1", session);
    cb?.({ requestId: "p1", method: "select", expectsResponse: true, payload: {} });

    const { backend } = makeBackend(backendOver(service));
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });
    const listed = await mcp.callTool("list_pending_ui_requests", {});
    const wireId = (listed.requests as Array<{ requestId: string }>)[0].requestId;
    const result = await mcp.callTool("respond_to_ui_request", { requestId: wireId, response: {} });
    expect(result).toMatchObject({ ok: false, error: "unsupported" });
  });

  it("MCP and WS race for the same dialog: the loser gets a not-found style error on its own surface", async () => {
    const { service, fire, calls } = wireService();
    fire({ requestId: "p1", method: "select", expectsResponse: true, payload: {} });
    const { backend } = makeBackend(backendOver(service));
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });
    const listed = await mcp.callTool("list_pending_ui_requests", {});
    const wireId = (listed.requests as Array<{ requestId: string }>)[0].requestId;

    // WS answers first (direct service call, as the router would).
    const wsResult = service.respond(wireId, { value: "ws-wins" });
    expect(wsResult.ok).toBe(true);

    // MCP's answer for the same id loses: unknown_ui_request, not a second delivery.
    const mcpResult = await mcp.callTool("respond_to_ui_request", {
      requestId: wireId,
      response: { value: "mcp-loses" },
    });
    expect(mcpResult).toMatchObject({ ok: false, error: "unknown_ui_request" });
    expect(calls).toEqual([["p1", { value: "ws-wins" }]]);
  });
});

describe("MCP injection config", () => {
  it("writes a per-agent --mcp-config under <home>/mcp with OAuth disabled", async () => {
    const { backend } = makeBackend();
    const mcp = new McpServer({
      backend,
      enabled: true,
      injectIntoAgents: true,
      home,
      baseUrl: "http://127.0.0.1:7777",
    });
    const path = await mcp.writeInjectionConfig("42");
    expect(path).toBe(join(home, "mcp", "agent-42.json"));
    const written = JSON.parse(await readFile(path!, "utf8"));
    const server = written.mcpServers[MCP_SERVER_KEY];
    expect(server.url).toBe("http://127.0.0.1:7777/mcp/agents");
    expect(server.auth).toBe(false);
    expect(server.oauth).toBe(false);
  });

  it("does not write a config when injectIntoAgents is off", async () => {
    const { backend } = makeBackend();
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });
    expect(await mcp.writeInjectionConfig("agent-1")).toBeNull();
    expect(mcp.injectionConfig()).toBeNull();
  });
});

describe("MCP disabled", () => {
  it("exposes no tools and rejects calls when disabled", async () => {
    const { backend } = makeBackend();
    const mcp = new McpServer({ backend, enabled: false, injectIntoAgents: true, home });
    expect(mcp.enabled).toBe(false);
    expect(mcp.toolNames()).toEqual([]);
    expect(await mcp.callTool("create_agent", { config: {} })).toMatchObject({
      ok: false,
      error: "mcp_disabled",
    });
    expect(mcp.injectionConfig()).toBeNull();
  });

  it("exposes the documented core tool set when enabled", () => {
    const { backend } = makeBackend();
    const mcp = new McpServer({ backend, enabled: true, injectIntoAgents: false, home });
    const names = mcp.toolNames();
    for (const expected of [
      "create_agent",
      "wait_for_agent",
      "respond_to_permission",
      "list_agents",
      "list_providers",
      "list_pending_ui_requests",
      "respond_to_ui_request",
    ]) {
      expect(names).toContain(expected);
    }
  });
});
