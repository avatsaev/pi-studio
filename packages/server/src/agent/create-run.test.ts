import { describe, expect, it } from "vitest";
import { CLIENT_CAPS } from "@av-pi-studio/protocol";
import { agentCalls } from "../test-support/answer-then-run.js";
import type { Session } from "../ws/session.js";
import { AgentManager } from "./agent-manager.js";
import { AgentService } from "./agent-service.js";
import { INLINE_IMAGE_INSTRUCTIONS } from "./inline-image-instructions.js";
import { FILE_LINK_INSTRUCTIONS } from "./file-link-instructions.js";
import { MERMAID_DIAGRAM_INSTRUCTIONS } from "./mermaid-diagram-instructions.js";
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

/** The `agent_update` statuses a client saw, in order. */
function updateStatuses(broadcasts: unknown[]): unknown[] {
  return broadcasts.flatMap((frame) =>
    typeof frame === "object" && frame !== null && "type" in frame && frame.type === "agent_update"
      ? ["status" in frame ? frame.status : undefined]
      : [],
  );
}

describe("create_agent_request", () => {
  it("creates an agent, runs the first turn, and streams events", async () => {
    const { service, manager, broadcasts } = makeService();
    const result = await agentCalls(service).create({
      requestId: "req-1",
      config: { provider: "mock", cwd: "/work" },
      initialPrompt: "do it",
    });

    expect(result.type).toBe("create_agent_response");
    const { agentId } = result.payload;
    expect(typeof agentId).toBe("string");

    // The turn runs on after the answer; wait for it to settle.
    await service.turnSettled(agentId);

    // Agent ends in idle.
    expect(manager.get(agentId)?.record.lastStatus).toBe("idle");

    // Expected agent_update sequence: initializing, running, idle — the agent is `running` from
    // acceptance, never `idle` in between.
    expect(updateStatuses(broadcasts)).toEqual(["initializing", "running", "idle"]);

    const streams = broadcasts.filter(
      (frame) =>
        typeof frame === "object" &&
        frame !== null &&
        "message" in frame &&
        typeof frame.message === "object" &&
        frame.message !== null &&
        "type" in frame.message &&
        frame.message.type === "agent_stream",
    );
    expect(streams.length).toBeGreaterThan(0);
  });

  it("emits exactly one user_message row per prompt (canonical rule)", async () => {
    const { service, manager } = makeService();
    const result = await agentCalls(service).createSettled({
      requestId: "r2",
      config: { provider: "mock", cwd: "/work" },
      initialPrompt: "hello",
      clientMessageId: "cm-1",
    });

    const timeline = manager.timelines.get(result.payload.agentId);
    expect(timeline).toBeDefined();
    const userRows = timeline!.allRows().filter((r) => r.event.kind === "user_message");
    expect(userRows).toHaveLength(1);
    expect(userRows[0]?.event.kind === "user_message" ? userRows[0].event.messageId : null).toBe(
      "cm-1",
    );
  });

  it("broadcasts agent_update on status change; response correlates by requestId", async () => {
    const { service, broadcasts } = makeService();
    const result = await agentCalls(service).create({
      requestId: "req-X",
      config: { provider: "mock", cwd: "/w" },
    });
    expect(result.type).toBe("create_agent_response");
    expect(result.requestId).toBe("req-X");
    expect(result.payload.agentId).toBeDefined();
    expect(updateStatuses(broadcasts)).not.toEqual([]);
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

    const result = await agentCalls(service).create({
      requestId: "req-draft",
      config: { provider: "mock", cwd: "/w", model: "picked-model" },
    });
    const { agentId } = result.payload;

    // No provider process was ever spawned — `resolveClient` (the only path to `createSession`)
    // is never called for a deferred draft.
    expect(resolveClientCalls).toBe(0);
    const managed = manager.get(agentId);
    expect(managed?.session).toBeNull();
    expect(managed?.record.lastStatus).toBe("idle");
    expect(service.hasTurn(agentId)).toBe(false);
    // The raw client config still lands on the record so a later first-spawn (`handleSendPrompt`/
    // `handleResume`) can use it — including the pinned model for replay.
    expect(managed?.record.config?.model).toBe("picked-model");
  });
});

function fakeSession(options: {
  supportsInlineImages?: boolean;
  supportsFileLinks?: boolean;
  supportsMermaid?: boolean;
}): Pick<Session, "supports"> {
  return {
    supports: (flag) => {
      if (flag === CLIENT_CAPS.inline_image_markdown) return options.supportsInlineImages ?? false;
      if (flag === CLIENT_CAPS.file_link_markdown) return options.supportsFileLinks ?? false;
      if (flag === CLIENT_CAPS.mermaid_diagram_markdown) return options.supportsMermaid ?? false;
      return false;
    },
  };
}

/** The system prompt a draft created over `connection` was persisted with. */
async function systemPromptOf(
  config: Record<string, unknown>,
  connection?: Pick<Session, "supports">,
): Promise<unknown> {
  const { service, manager } = makeService();
  const result = await agentCalls(service).create(
    { config: { provider: "mock", cwd: "/w", ...config } },
    connection,
  );
  return manager.get(result.payload.agentId)?.record.config?.systemPrompt;
}

describe("inline_image_markdown capability composes the system prompt (task-006)", () => {
  it("appends the instruction when the creating connection advertised the capability", async () => {
    expect(await systemPromptOf({}, fakeSession({ supportsInlineImages: true }))).toBe(
      INLINE_IMAGE_INSTRUCTIONS,
    );
  });

  it("leaves systemPrompt absent when the connection did not advertise the capability", async () => {
    expect(await systemPromptOf({}, fakeSession({}))).toBeUndefined();
  });

  it("leaves systemPrompt untouched when no session is passed at all (e.g. CLI-created)", async () => {
    expect(await systemPromptOf({})).toBeUndefined();
  });

  it("appends after a caller-supplied prompt, separated by a blank line — never replaces or reorders it", async () => {
    expect(
      await systemPromptOf(
        { systemPrompt: "be terse" },
        fakeSession({ supportsInlineImages: true }),
      ),
    ).toBe(`be terse\n\n${INLINE_IMAGE_INSTRUCTIONS}`);
  });
});

describe("capability-gated instruction composition (task-005)", () => {
  it("neither flag advertised: effectiveConfig.systemPrompt === config.systemPrompt (including undefined staying undefined)", async () => {
    expect(await systemPromptOf({}, fakeSession({}))).toBeUndefined();
  });

  it("only inline_image_markdown advertised: persisted systemPrompt is the instruction (or after caller prompt)", async () => {
    expect(await systemPromptOf({}, fakeSession({ supportsInlineImages: true }))).toBe(
      INLINE_IMAGE_INSTRUCTIONS,
    );
  });

  it("only file_link_markdown advertised: persisted systemPrompt contains FILE_LINK_INSTRUCTIONS, not image instruction", async () => {
    expect(await systemPromptOf({}, fakeSession({ supportsFileLinks: true }))).toBe(
      FILE_LINK_INSTRUCTIONS,
    );
  });

  it("both advertised: both blocks present, in stable order (image, then file-link)", async () => {
    const prompt = await systemPromptOf(
      {},
      fakeSession({ supportsInlineImages: true, supportsFileLinks: true }),
    );
    expect(prompt).toBe(`${INLINE_IMAGE_INSTRUCTIONS}\n\n${FILE_LINK_INSTRUCTIONS}`);
  });

  it("caller-supplied prompt with both capabilities: prompt always first, never mutated/reordered", async () => {
    const callerPrompt = "be helpful and concise";
    const prompt = await systemPromptOf(
      { systemPrompt: callerPrompt },
      fakeSession({ supportsInlineImages: true, supportsFileLinks: true }),
    );
    expect(prompt).toBe(
      `${callerPrompt}\n\n${INLINE_IMAGE_INSTRUCTIONS}\n\n${FILE_LINK_INSTRUCTIONS}`,
    );
  });

  it("only mermaid_diagram_markdown advertised: persisted systemPrompt is the mermaid instruction, not image/file-link", async () => {
    expect(await systemPromptOf({}, fakeSession({ supportsMermaid: true }))).toBe(
      MERMAID_DIAGRAM_INSTRUCTIONS,
    );
  });

  it("all three advertised: all three blocks present, in stable order (image, file-link, mermaid)", async () => {
    const prompt = await systemPromptOf(
      {},
      fakeSession({ supportsInlineImages: true, supportsFileLinks: true, supportsMermaid: true }),
    );
    expect(prompt).toBe(
      `${INLINE_IMAGE_INSTRUCTIONS}\n\n${FILE_LINK_INSTRUCTIONS}\n\n${MERMAID_DIAGRAM_INSTRUCTIONS}`,
    );
  });
});
