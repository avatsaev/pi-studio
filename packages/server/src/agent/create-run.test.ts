import { describe, expect, it } from "vitest";
import { CLIENT_CAPS } from "@av-pi-studio/protocol";
import { AgentManager } from "./agent-manager.js";
import { AgentService, getTimeline } from "./agent-service.js";
import { INLINE_IMAGE_INSTRUCTIONS } from "./inline-image-instructions.js";
import { MockAgentClient } from "./providers/mock/mock-provider.js";

const NOW = "2026-06-11T12:00:00.000Z";

function makeService(): {
  service: AgentService;
  manager: AgentManager;
  broadcasts: unknown[];
} {
  const broadcasts: unknown[] = [];
  const manager = new AgentManager({
    home: "/unused",
    saveAgent: () => Promise.resolve(),
    loadAllAgents: () => Promise.resolve([]),
    now: () => NOW,
  });
  const client = new MockAgentClient({ turnDelayMs: 0 });
  const service = new AgentService({
    manager,
    resolveClient: () => client,
    broadcast: (_, msg) => broadcasts.push(msg),
    now: () => NOW,
  });
  return { service, manager, broadcasts };
}

describe("create_agent_request", () => {
  it("creates an agent, runs the first turn, and streams events", async () => {
    const { service, manager, broadcasts } = makeService();
    const result = (await service.handleCreate(
      {
        requestId: "req-1",
        config: { provider: "mock", cwd: "/work" },
        initialPrompt: "do it",
      },
      () => [],
    )) as Record<string, unknown>;

    expect(result.type).toBe("create_agent_response");
    const agentId = (result.payload as Record<string, unknown>).agentId as string;
    expect(typeof agentId).toBe("string");

    // Agent ends in idle.
    expect(manager.get(agentId)?.record.lastStatus).toBe("idle");

    // Expected broadcast sequence: initializing, idle, running, agent_stream × N, idle.
    const statuses = broadcasts
      .filter((b) => (b as Record<string, unknown>).type === "agent_update")
      .map((b) => (b as Record<string, unknown>).status);
    expect(statuses).toEqual(["initializing", "idle", "running", "idle"]);

    const streams = broadcasts.filter(
      (b) =>
        (b as Record<string, unknown>).type === "session" &&
        ((b as Record<string, unknown>).message as Record<string, unknown>)?.type ===
          "agent_stream",
    );
    expect(streams.length).toBeGreaterThan(0);
  });

  it("emits exactly one user_message row per prompt (canonical rule)", async () => {
    const { service } = makeService();
    const result = (await service.handleCreate(
      {
        requestId: "r2",
        config: { provider: "mock", cwd: "/work" },
        initialPrompt: "hello",
        clientMessageId: "cm-1",
      },
      () => [],
    )) as Record<string, unknown>;

    const agentId = (result.payload as Record<string, unknown>).agentId as string;
    const timeline = getTimeline(agentId);
    expect(timeline).toBeDefined();
    const userRows = timeline!.allRows().filter((r) => r.event.kind === "user_message");
    expect(userRows).toHaveLength(1);
    expect(userRows[0]?.event.kind === "user_message" ? userRows[0].event.messageId : null).toBe(
      "cm-1",
    );
  });

  it("broadcasts agent_update on status change; response correlates by requestId", async () => {
    const { service, broadcasts } = makeService();
    const result = (await service.handleCreate(
      { requestId: "req-X", config: { provider: "mock", cwd: "/w" } },
      () => [],
    )) as Record<string, unknown>;
    expect(result.type).toBe("create_agent_response");
    expect((result.payload as Record<string, unknown>).agentId).toBeDefined();
    expect(broadcasts.some((b) => (b as Record<string, unknown>).type === "agent_update")).toBe(
      true,
    );
  });

  it("defers the process spawn for a draft created with no initialPrompt (deferred draft)", async () => {
    let resolveClientCalls = 0;
    const manager = new AgentManager({
      home: "/unused",
      saveAgent: () => Promise.resolve(),
      loadAllAgents: () => Promise.resolve([]),
      now: () => NOW,
    });
    const client = new MockAgentClient({ turnDelayMs: 0 });
    const service = new AgentService({
      manager,
      resolveClient: () => {
        resolveClientCalls += 1;
        return client;
      },
      broadcast: () => {},
      now: () => NOW,
    });

    const result = (await service.handleCreate(
      { requestId: "req-draft", config: { provider: "mock", cwd: "/w", model: "picked-model" } },
      () => [],
    )) as Record<string, unknown>;
    const agentId = (result.payload as Record<string, unknown>).agentId as string;

    // No provider process was ever spawned — `resolveClient` (the only path to `createSession`)
    // is never called for a deferred draft.
    expect(resolveClientCalls).toBe(0);
    const managed = manager.get(agentId);
    expect(managed?.session).toBeNull();
    expect(managed?.record.lastStatus).toBe("idle");
    // The raw client config still lands on the record so a later first-spawn (`handleSendPrompt`/
    // `handleResume`) can use it — including the pinned model for replay.
    expect(managed?.record.config?.model).toBe("picked-model");
  });
});

function fakeSession(supportsInlineImages: boolean): { supports: (flag: string) => boolean } {
  return { supports: (flag) => supportsInlineImages && flag === CLIENT_CAPS.inline_image_markdown };
}

describe("inline_image_markdown capability composes the system prompt (task-006)", () => {
  it("appends the instruction when the creating connection advertised the capability", async () => {
    const { service, manager } = makeService();
    const result = (await service.handleCreate(
      { requestId: "req-cap", config: { provider: "mock", cwd: "/w" } },
      () => [],
      fakeSession(true) as never,
    )) as Record<string, unknown>;
    const agentId = (result.payload as Record<string, unknown>).agentId as string;
    expect(manager.get(agentId)?.record.config?.systemPrompt).toBe(INLINE_IMAGE_INSTRUCTIONS);
  });

  it("leaves systemPrompt absent when the connection did not advertise the capability", async () => {
    const { service, manager } = makeService();
    const result = (await service.handleCreate(
      { requestId: "req-nocap", config: { provider: "mock", cwd: "/w" } },
      () => [],
      fakeSession(false) as never,
    )) as Record<string, unknown>;
    const agentId = (result.payload as Record<string, unknown>).agentId as string;
    expect(manager.get(agentId)?.record.config?.systemPrompt).toBeUndefined();
  });

  it("leaves systemPrompt untouched when no session is passed at all (e.g. CLI-created)", async () => {
    const { service, manager } = makeService();
    const result = (await service.handleCreate(
      { requestId: "req-cli", config: { provider: "mock", cwd: "/w" } },
      () => [],
    )) as Record<string, unknown>;
    const agentId = (result.payload as Record<string, unknown>).agentId as string;
    expect(manager.get(agentId)?.record.config?.systemPrompt).toBeUndefined();
  });

  it("appends after a caller-supplied prompt, separated by a blank line — never replaces or reorders it", async () => {
    const { service, manager } = makeService();
    const result = (await service.handleCreate(
      {
        requestId: "req-caller-prompt",
        config: { provider: "mock", cwd: "/w", systemPrompt: "be terse" },
      },
      () => [],
      fakeSession(true) as never,
    )) as Record<string, unknown>;
    const agentId = (result.payload as Record<string, unknown>).agentId as string;
    expect(manager.get(agentId)?.record.config?.systemPrompt).toBe(
      `be terse\n\n${INLINE_IMAGE_INSTRUCTIONS}`,
    );
  });
});
