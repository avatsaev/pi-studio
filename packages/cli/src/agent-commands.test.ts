import { describe, expect, it } from "vitest";

import type { DaemonClient, Transport } from "@av-pi-studio/client";

import {
  AGENT_RPC,
  attachAgent,
  cloneAgentSession,
  compactAgent,
  cycleAgentModel,
  exportAgentHtml,
  forkAgent,
  forkMessagesAgent,
  formatStreamEvent,
  lastAssistantTextAgent,
  logsAgent,
  lsAgents,
  newAgentSession,
  parseProviderModel,
  runAgent,
  sendAgent,
  sessionStatsAgent,
  steerAgent,
  setAgentModel,
  setAgentSessionName,
  switchAgentSession,
} from "./agent-commands.js";
import { type CliContext, connectOptionsFrom } from "./cli-core.js";
import { connectDaemon } from "./connection.js";

// ─── Fake daemon transport (records requests, scripts responses + stream pushes) ──

interface FakeOptions {
  responses?: Record<string, unknown | ((msg: Record<string, unknown>) => unknown)>;
  /** Request types that should reply with an rpc_error instead of a response. */
  rpcErrors?: Record<string, { message: string; code?: string }>;
}

function makeFake(options: FakeOptions = {}): {
  transport: Transport;
  requests: Array<{ type: string; msg: Record<string, unknown> }>;
  push: (sessionMessage: Record<string, unknown>) => void;
} {
  const requests: Array<{ type: string; msg: Record<string, unknown> }> = [];
  let open = false;
  const transport: Transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    get isOpen() {
      return open;
    },
    connect: () => {
      open = true;
      return Promise.resolve();
    },
    sendText: (data) => {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      if (parsed.type === "hello") {
        queueMicrotask(() =>
          transport.onMessage?.(
            JSON.stringify({
              type: "status",
              payload: { status: "server_info", serverId: "s", capabilities: {}, features: {} },
            }),
          ),
        );
        return;
      }
      if (parsed.type === "session") {
        const msg = parsed.message as Record<string, unknown>;
        const reqType = msg.type as string;
        const requestId = msg.requestId as string;
        requests.push({ type: reqType, msg });
        const err = options.rpcErrors?.[reqType];
        if (err) {
          queueMicrotask(() =>
            transport.onMessage?.(
              JSON.stringify({
                type: "session",
                message: { type: "rpc_error", requestId, message: err.message, code: err.code },
              }),
            ),
          );
          return;
        }
        const r = options.responses?.[reqType];
        const payload =
          typeof r === "function" ? (r as (m: Record<string, unknown>) => unknown)(msg) : r;
        queueMicrotask(() =>
          transport.onMessage?.(
            JSON.stringify({
              type: "session",
              message: { type: `${reqType}_response`, requestId, payload: payload ?? {} },
            }),
          ),
        );
      }
    },
    sendBinary: () => {},
    close: () => {
      open = false;
    },
  };
  return {
    transport,
    requests,
    push: (sessionMessage) =>
      transport.onMessage?.(JSON.stringify({ type: "session", message: sessionMessage })),
  };
}

async function connectedClient(
  transport: Transport,
): Promise<{ client: DaemonClient; ctx: CliContext; out: string[] }> {
  const out: string[] = [];
  const ctx: CliContext = {
    connect: (opts) => connectDaemon(opts),
    sink: { write: (l) => out.push(l), error: () => {} },
    rpcTimeoutMs: 50,
    connectOverrides: { transport, clientId: "cli-test" },
  };
  const { client } = await ctx.connect(connectOptionsFrom(ctx, {}));
  return { client, ctx, out };
}

// ─── parseProviderModel ─────────────────────────────────────────────────────────

describe("parseProviderModel", () => {
  it("splits provider/model", () => {
    expect(parseProviderModel("pi/sonnet-4")).toEqual({ provider: "pi", model: "sonnet-4" });
  });
  it("defaults provider to pi when empty", () => {
    expect(parseProviderModel()).toEqual({ provider: "pi" });
  });
  it("handles a bare provider", () => {
    expect(parseProviderModel("mock")).toEqual({ provider: "mock" });
  });
});

// ─── formatStreamEvent ──────────────────────────────────────────────────────────

describe("formatStreamEvent", () => {
  it("renders an assistant message", () => {
    expect(formatStreamEvent({ kind: "assistant_message", text: "hi" })).toBe("hi");
  });
  it("renders a tool call with its detail", () => {
    expect(
      formatStreamEvent({ kind: "tool_call", tool: { kind: "shell", command: "ls -la" } }),
    ).toContain("ls -la");
  });
  it("renders a turn boundary", () => {
    expect(formatStreamEvent({ kind: "turn_completed" })).toContain("turn completed");
  });
});

// ─── run / ls / send / logs / attach ────────────────────────────────────────────

describe("agent commands", () => {
  it("run creates+runs an agent and prints its id", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.create]: { agentId: "agent-123" } } });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await runAgent(client, ctx, "do the thing", { provider: "pi/sonnet-4" });
    expect(code).toBe(0);
    expect(out[0]).toBe("agent-123");
    const created = fake.requests.find((r) => r.type === AGENT_RPC.create)!;
    const config = created.msg.config as Record<string, unknown>;
    expect(config.provider).toBe("pi");
    expect(config.model).toBe("sonnet-4");
    expect(created.msg.initialPrompt).toBe("do the thing");
  });

  it("run passes --worktree as worktreeName", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.create]: { agentId: "a" } } });
    const { client, ctx } = await connectedClient(fake.transport);
    await runAgent(client, ctx, "x", { provider: "pi/m", worktree: "feature-x", cwd: "/tmp" });
    const created = fake.requests.find((r) => r.type === AGENT_RPC.create)!;
    expect(created.msg.worktreeName).toBe("feature-x");
    expect((created.msg.config as Record<string, unknown>).cwd).toBe("/tmp");
  });

  it("ls lists agents as a table and sends all/global flags", async () => {
    const fake = makeFake({
      responses: {
        [AGENT_RPC.list]: { agents: [{ agentId: "a1", status: "running", provider: "pi" }] },
      },
    });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await lsAgents(client, ctx, { all: true, global: true });
    expect(code).toBe(0);
    expect(out[0]).toContain("a1");
    expect(out[0]).toContain("running");
    const req = fake.requests.find((r) => r.type === AGENT_RPC.list)!;
    expect(req.msg.all).toBe(true);
    expect(req.msg.global).toBe(true);
  });

  it("send maps to send_agent_prompt", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.send]: {} } });
    const { client, ctx } = await connectedClient(fake.transport);
    await sendAgent(client, ctx, "a1", "also add tests", {});
    const req = fake.requests.find((r) => r.type === AGENT_RPC.send)!;
    expect(req.msg.agentId).toBe("a1");
    expect(req.msg.prompt).toBe("also add tests");
  });

  it("steer maps to steer_agent_request", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.steer]: { ok: true } } });
    const { client, ctx } = await connectedClient(fake.transport);
    await steerAgent(client, ctx, "a1", "focus on tests", {}, "steer");
    const req = fake.requests.find((r) => r.type === AGENT_RPC.steer)!;
    expect(req.msg.agentId).toBe("a1");
    expect(req.msg.message).toBe("focus on tests");
  });

  it("follow-up maps to follow_up_agent_request", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.followUp]: { ok: true } } });
    const { client, ctx } = await connectedClient(fake.transport);
    await steerAgent(client, ctx, "a1", "then summarize", {}, "followUp");
    const req = fake.requests.find((r) => r.type === AGENT_RPC.followUp)!;
    expect(req.msg.message).toBe("then summarize");
  });

  it("formatStreamEvent renders a queue_update", () => {
    expect(
      formatStreamEvent({ kind: "queue_update", steering: ["fix errors"], followUp: [] }),
    ).toBe("~ queue [steering: fix errors]");
    expect(formatStreamEvent({ kind: "queue_update", steering: [], followUp: [] })).toBe(
      "~ queue [empty]",
    );
  });

  it("logs fetches the timeline backward and renders events", async () => {
    const fake = makeFake({
      responses: {
        [AGENT_RPC.timeline]: {
          items: [{ event: { kind: "assistant_message", text: "done" } }],
        },
      },
    });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await logsAgent(client, ctx, "a1", { limit: 10 });
    expect(code).toBe(0);
    expect(out[0]).toBe("done");
    const req = fake.requests.find((r) => r.type === AGENT_RPC.timeline)!;
    expect(req.msg.direction).toBe("backward");
    expect(req.msg.limit).toBe(10);
  });

  it("attach streams events and exits on a terminal turn event when untilTurnEnd", async () => {
    const fake = makeFake();
    const { client, ctx, out } = await connectedClient(fake.transport);
    const done = attachAgent(client, ctx, "a1", { untilTurnEnd: true });
    fake.push({
      type: "agent_stream",
      agentId: "a1",
      event: { kind: "assistant_message", text: "hi" },
    });
    fake.push({
      type: "agent_stream",
      agentId: "other",
      event: { kind: "assistant_message", text: "ignored" },
    });
    fake.push({ type: "agent_stream", agentId: "a1", event: { kind: "turn_completed" } });
    const code = await done;
    expect(code).toBe(0);
    expect(out).toContain("hi");
    expect(out.join("\n")).not.toContain("ignored");
    expect(out.join("\n")).toContain("turn completed");
  });

  it("attach resolves when the abort signal fires", async () => {
    const fake = makeFake();
    const { client, ctx } = await connectedClient(fake.transport);
    const controller = new AbortController();
    const done = attachAgent(client, ctx, "a1", { signal: controller.signal });
    controller.abort();
    expect(await done).toBe(0);
  });
});

// ─── Slash-command operations (sprint-037) ───────────────────────────────────────

describe("agent slash-command operations", () => {
  it("sessionStatsAgent issues agent_session_stats_request and renders the payload", async () => {
    const fake = makeFake({
      responses: { [AGENT_RPC.sessionStats]: { sessionId: "s1", totalMessages: 3 } },
    });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await sessionStatsAgent(client, ctx, "a1", {});
    expect(code).toBe(0);
    expect(out[0]).toContain("s1");
    const req = fake.requests.find((r) => r.type === AGENT_RPC.sessionStats)!;
    expect(req.msg.agentId).toBe("a1");
  });

  it("compactAgent forwards customInstructions", async () => {
    const fake = makeFake({
      responses: { [AGENT_RPC.compact]: { summary: "done", tokensBefore: 500 } },
    });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await compactAgent(client, ctx, "a1", "focus on code", {});
    expect(code).toBe(0);
    expect(out[0]).toContain("done");
    const req = fake.requests.find((r) => r.type === AGENT_RPC.compact)!;
    expect(req.msg.customInstructions).toBe("focus on code");
  });

  it("newAgentSession reports 'new session started' when not cancelled", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.newSession]: { cancelled: false } } });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await newAgentSession(client, ctx, "a1", {});
    expect(code).toBe(0);
    expect(out[0]).toBe("new session started");
  });

  it("switchAgentSession forwards sessionPath", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.switchSession]: { cancelled: false } } });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await switchAgentSession(client, ctx, "a1", "/tmp/other.jsonl", {});
    expect(code).toBe(0);
    expect(out[0]).toBe("session switched");
    const req = fake.requests.find((r) => r.type === AGENT_RPC.switchSession)!;
    expect(req.msg.sessionPath).toBe("/tmp/other.jsonl");
  });

  it("forkAgent forwards entryId and renders the result", async () => {
    const fake = makeFake({
      responses: { [AGENT_RPC.fork]: { text: "forked text", cancelled: false } },
    });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await forkAgent(client, ctx, "a1", "e1", {});
    expect(code).toBe(0);
    expect(out[0]).toContain("forked text");
    const req = fake.requests.find((r) => r.type === AGENT_RPC.fork)!;
    expect(req.msg.entryId).toBe("e1");
  });

  it("forkMessagesAgent renders the picker list as a table", async () => {
    const fake = makeFake({
      responses: {
        [AGENT_RPC.forkMessages]: { messages: [{ entryId: "e1", text: "first prompt" }] },
      },
    });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await forkMessagesAgent(client, ctx, "a1", {});
    expect(code).toBe(0);
    expect(out[0]).toContain("e1");
    expect(out[0]).toContain("first prompt");
  });

  it("setAgentSessionName forwards name and reports 'renamed'", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.setSessionName]: {} } });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await setAgentSessionName(client, ctx, "a1", "my-feature", {});
    expect(code).toBe(0);
    expect(out[0]).toBe("renamed");
    const req = fake.requests.find((r) => r.type === AGENT_RPC.setSessionName)!;
    expect(req.msg.name).toBe("my-feature");
  });

  it("exportAgentHtml forwards outputPath and prints the resulting path", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.exportHtml]: { path: "/tmp/out.html" } } });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await exportAgentHtml(client, ctx, "a1", "/tmp/out.html", {});
    expect(code).toBe(0);
    expect(out[0]).toBe("/tmp/out.html");
    const req = fake.requests.find((r) => r.type === AGENT_RPC.exportHtml)!;
    expect(req.msg.outputPath).toBe("/tmp/out.html");
  });

  it("cloneAgentSession reports 'cloned' when not cancelled", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.clone]: { cancelled: false } } });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await cloneAgentSession(client, ctx, "a1", {});
    expect(code).toBe(0);
    expect(out[0]).toBe("cloned");
  });

  it("setAgentModel forwards provider+modelId", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.setModel]: { id: "m1" } } });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await setAgentModel(client, ctx, "a1", "anthropic", "m1", {});
    expect(code).toBe(0);
    expect(out[0]).toContain("m1");
    const req = fake.requests.find((r) => r.type === AGENT_RPC.setModel)!;
    expect(req.msg.provider).toBe("anthropic");
    expect(req.msg.modelId).toBe("m1");
  });

  it("cycleAgentModel renders the resulting model", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.cycleModel]: { model: { id: "m2" } } } });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await cycleAgentModel(client, ctx, "a1", {});
    expect(code).toBe(0);
    expect(out[0]).toContain("m2");
  });

  it("lastAssistantTextAgent prints the text, or '(none)' when null", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.lastAssistantText]: { text: "hello" } } });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await lastAssistantTextAgent(client, ctx, "a1", {});
    expect(code).toBe(0);
    expect(out[0]).toBe("hello");

    const fakeNone = makeFake({ responses: { [AGENT_RPC.lastAssistantText]: { text: null } } });
    const { client: client2, ctx: ctx2, out: out2 } = await connectedClient(fakeNone.transport);
    const code2 = await lastAssistantTextAgent(client2, ctx2, "a1", {});
    expect(code2).toBe(0);
    expect(out2[0]).toBe("(none)");
  });

  it("an unsupported provider method surfaces a clean CLI error (rpc_error → RpcError → nonzero exit)", async () => {
    const fake = makeFake({
      rpcErrors: {
        [AGENT_RPC.exportHtml]: {
          message: "agent a1's provider does not support 'export_html'",
          code: "handler_error",
        },
      },
    });
    const { client, ctx } = await connectedClient(fake.transport);
    await expect(exportAgentHtml(client, ctx, "a1", undefined, {})).rejects.toThrow(
      /does not support/,
    );
  });
});
