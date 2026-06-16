import { readFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PARENT_AGENT_ID_LABEL } from "./agent-manager.js";
import { McpServer, MCP_SERVER_KEY, type McpBackend } from "./mcp-server.js";

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
    ]) {
      expect(names).toContain(expected);
    }
  });
});
