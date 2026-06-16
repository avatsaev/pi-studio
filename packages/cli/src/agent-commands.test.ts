import { describe, expect, it } from "vitest";

import type { DaemonClient, Transport } from "@av-pi-studio/client";

import {
  AGENT_RPC,
  attachAgent,
  formatStreamEvent,
  logsAgent,
  lsAgents,
  parseProviderModel,
  runAgent,
  sendAgent,
} from "./agent-commands.js";
import { type CliContext, connectOptionsFrom } from "./cli-core.js";
import { connectDaemon } from "./connection.js";

// ─── Fake daemon transport (records requests, scripts responses + stream pushes) ──

interface FakeOptions {
  responses?: Record<string, unknown | ((msg: Record<string, unknown>) => unknown)>;
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
