import { describe, expect, it, vi } from "vitest";

import {
  type DaemonClient,
  PI_COMMAND_TIMEOUT_MS,
  SESSION_START_TIMEOUT_MS,
  type Transport,
} from "@av-pi-studio/client";

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
  listAgentCommands,
  logsAgent,
  lsAgents,
  newAgentSession,
  parseProviderModel,
  parseTimeoutSeconds,
  runAgent,
  sendAgent,
  sessionStatsAgent,
  setAgentModel,
  setAgentSessionName,
  settledOutcome,
  steerAgent,
  switchAgentSession,
  unsettledOutcome,
  waitAgent,
} from "./agent-commands.js";
import { type CliContext, connectOptionsFrom } from "./cli-core.js";
import { connectDaemon } from "./connection.js";

// ─── Fake daemon transport (records requests, scripts responses + stream pushes) ──

interface FakeOptions {
  responses?: Record<string, unknown | ((msg: Record<string, unknown>) => unknown)>;
  /** Request types that should reply with an rpc_error instead of a response. */
  rpcErrors?: Record<string, { message: string; code?: string }>;
}

interface FakeDaemon {
  transport: Transport;
  requests: Array<{ type: string; msg: Record<string, unknown> }>;
  push: (sessionMessage: Record<string, unknown>) => void;
}

function makeFake(options: FakeOptions = {}): FakeDaemon {
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
): Promise<{ client: DaemonClient; ctx: CliContext; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    connect: (opts) => connectDaemon(opts),
    sink: { write: (l) => out.push(l), error: (l) => err.push(l) },
    rpcTimeoutMs: 50,
    connectOverrides: { transport, clientId: "cli-test" },
  };
  const { client } = await ctx.connect(connectOptionsFrom(ctx, {}));
  return { client, ctx, out, err };
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
    const code = await runAgent(client, ctx, "do the thing", {
      provider: "pi/sonnet-4",
      wait: false,
    });
    expect(code).toBe(0);
    expect(out).toEqual(["agent-123"]);
    const created = fake.requests.find((r) => r.type === AGENT_RPC.create)!;
    const config = created.msg.config as Record<string, unknown>;
    expect(config.provider).toBe("pi");
    expect(config.model).toBe("sonnet-4");
    expect(created.msg.initialPrompt).toBe("do the thing");
  });

  it("run passes --worktree as worktreeName", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.create]: { agentId: "a" } } });
    const { client, ctx } = await connectedClient(fake.transport);
    await runAgent(client, ctx, "x", {
      provider: "pi/m",
      worktree: "feature-x",
      cwd: "/tmp",
      wait: false,
    });
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
    const fake = makeFake({ responses: { [AGENT_RPC.send]: { agentId: "a1" } } });
    const { client, ctx, out } = await connectedClient(fake.transport);
    expect(await sendAgent(client, ctx, "a1", "also add tests", { wait: false })).toBe(0);
    const req = fake.requests.find((r) => r.type === AGENT_RPC.send)!;
    expect(req.msg.agentId).toBe("a1");
    expect(req.msg.prompt).toBe("also add tests");
    expect(out).toEqual(["a1"]);
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
    expect(req.msg.direction).toBe("before");
    expect(req.msg.limit).toBe(10);
  });

  it("logs flattens real projected timeline items (grouped tool_call/assistant, standalone other) without crashing", async () => {
    const fake = makeFake({
      responses: {
        [AGENT_RPC.timeline]: {
          items: [
            { kind: "other", event: { kind: "turn_started" }, sourceSeq: 0 },
            {
              kind: "tool_call",
              callId: "c1",
              sourceSeqStart: 1,
              sourceSeqEnd: 2,
              events: [
                {
                  kind: "tool_call",
                  callId: "c1",
                  tool: { kind: "shell", command: "ls" },
                  status: "running",
                },
                {
                  kind: "tool_call",
                  callId: "c1",
                  tool: { kind: "shell", command: "ls", output: "a.txt" },
                  status: "completed",
                },
              ],
            },
            {
              kind: "assistant",
              sourceSeqStart: 3,
              sourceSeqEnd: 4,
              events: [
                { kind: "assistant_message", text: "Hi" },
                { kind: "assistant_message", text: " there" },
              ],
            },
            { kind: "other", event: { kind: "turn_completed" }, sourceSeq: 5 },
          ],
        },
      },
    });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await logsAgent(client, ctx, "a1", { limit: 10 });
    expect(code).toBe(0);
    expect(out).toEqual([
      "--- turn started ---",
      "[shell running] ls",
      "[shell completed] ls",
      "Hi",
      " there",
      "--- turn completed ---",
    ]);
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

  it("attach --until-idle exits non-zero when the turn failed, and zero when it was canceled", async () => {
    for (const [kind, expected] of [
      ["turn_failed", 1],
      ["turn_canceled", 0],
    ] as const) {
      const fake = makeFake();
      const { client, ctx, out } = await connectedClient(fake.transport);
      const done = attachAgent(client, ctx, "a1", { untilTurnEnd: true });
      fake.push({ type: "agent_stream", agentId: "a1", event: { kind, error: "boom" } });
      expect(await done).toBe(expected);
      expect(out).toHaveLength(1);
    }
  });

  it("attach ignores partial tool_call frames in plain and json modes", async () => {
    for (const json of [false, true]) {
      const fake = makeFake();
      const { client, ctx, out } = await connectedClient(fake.transport);
      const done = attachAgent(client, ctx, "a1", { untilTurnEnd: true, json });
      const partial = {
        type: "agent_stream",
        agentId: "a1",
        event: {
          kind: "tool_call",
          callId: "c1",
          status: "running",
          partial: true,
          tool: { kind: "shell", command: "npm test" },
        },
      };
      fake.push(partial);
      fake.push({
        type: "agent_stream",
        agentId: "a1",
        event: { kind: "assistant_message", text: "hi" },
      });
      fake.push(partial);
      fake.push({ type: "agent_stream", agentId: "a1", event: { kind: "turn_completed" } });
      expect(await done).toBe(0);
      const text = out.join("\n");
      expect(text).not.toContain("npm test");
      expect(text).toContain("hi");
      expect(out).toHaveLength(2);
    }
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

// ─── run / send / wait follow the turn (sprint-152) ─────────────────────────────

/** A daemon that accepts create/send for agent `a1` and reports it `running` when asked. */
function acceptingFake(
  listing: unknown = { agents: [{ agentId: "a1", status: "running" }] },
): FakeDaemon {
  return makeFake({
    responses: {
      [AGENT_RPC.create]: { agentId: "a1" },
      [AGENT_RPC.send]: { agentId: "a1" },
      [AGENT_RPC.list]: listing,
    },
  });
}

/** Resolves once the command went to wait: its status read is on the wire. */
const untilWaiting = (fake: FakeDaemon): Promise<void> =>
  vi.waitFor(() => expect(fake.requests.map((r) => r.type)).toContain(AGENT_RPC.list));

const settle = (status: string) => ({ type: "agent_update", agentId: "a1", status });
const failedRow = (error: string) => ({
  type: "agent_stream",
  agentId: "a1",
  event: { kind: "turn_failed", error },
});

describe("run, send and wait follow the turn", () => {
  it("run prints the id before the turn ends and exits 0 after it", async () => {
    const fake = acceptingFake();
    const { client, ctx, out, err } = await connectedClient(fake.transport);
    const done = runAgent(client, ctx, "go", {});
    await untilWaiting(fake);
    expect(out).toEqual(["a1"]);
    expect(await Promise.race([done, Promise.resolve("still waiting")])).toBe("still waiting");
    fake.push(settle("idle"));
    expect(await done).toBe(0);
    expect(out).toEqual(["a1"]);
    expect(err).toEqual([]);
  });

  it("a failed turn exits non-zero with the turn_failed reason on stderr", async () => {
    const fake = acceptingFake();
    const { client, ctx, out, err } = await connectedClient(fake.transport);
    const done = runAgent(client, ctx, "go", {});
    await untilWaiting(fake);
    fake.push(failedRow("provider exploded"));
    fake.push(settle("error"));
    expect(await done).toBe(1);
    expect(out).toEqual(["a1"]);
    expect(err).toEqual(["error: provider exploded"]);
  });

  it("an error with no turn_failed row still says so on stderr", async () => {
    const fake = acceptingFake();
    const { client, ctx, err } = await connectedClient(fake.transport);
    const done = runAgent(client, ctx, "go", {});
    await untilWaiting(fake);
    fake.push(settle("error"));
    expect(await done).toBe(1);
    expect(err).toEqual(["error: agent a1 ended with status error"]);
  });

  it("run --json prints exactly one line at the end: idle, then a failure", async () => {
    for (const [events, expected] of [
      [[settle("idle")], { agentId: "a1", status: "idle" }],
      [[failedRow("boom"), settle("error")], { agentId: "a1", status: "error", error: "boom" }],
    ] as const) {
      const fake = acceptingFake();
      const { client, ctx, out } = await connectedClient(fake.transport);
      const done = runAgent(client, ctx, "go", { json: true });
      await untilWaiting(fake);
      for (const event of events) fake.push(event);
      await done;
      expect(out).toHaveLength(1);
      expect(out[0]).not.toContain("\n");
      expect(JSON.parse(out[0]!)).toEqual(expected);
    }
  });

  it("run --no-wait returns at once with exit 0 and never reads the agent's status", async () => {
    for (const json of [false, true]) {
      const fake = acceptingFake();
      const { client, ctx, out } = await connectedClient(fake.transport);
      expect(await runAgent(client, ctx, "go", { wait: false, json })).toBe(0);
      expect(out).toEqual([json ? '{"agentId":"a1"}' : "a1"]);
      expect(fake.requests.map((r) => r.type)).toEqual([AGENT_RPC.create]);
    }
  });

  it("--timeout ends the wait non-zero, leaves the turn running and reports it", async () => {
    const fake = acceptingFake();
    const { client, ctx, out, err } = await connectedClient(fake.transport);
    vi.useFakeTimers();
    try {
      const done = runAgent(client, ctx, "go", { json: true, timeoutSeconds: 20 });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await done).toBe(1);
      expect(JSON.parse(out[0]!)).toEqual({ agentId: "a1", error: "timeout" });
      expect(out).toHaveLength(1);
      expect(err[0]).toContain("keeps running");
      expect(fake.requests.map((r) => r.type)).not.toContain(AGENT_RPC.stop);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Ctrl-C ends the wait only: non-zero, says so on stderr, the turn is not stopped", async () => {
    const fake = acceptingFake();
    const { client, ctx, out, err } = await connectedClient(fake.transport);
    const controller = new AbortController();
    const done = runAgent(client, ctx, "go", { json: true, signal: controller.signal });
    await untilWaiting(fake);
    controller.abort();
    expect(await done).toBe(1);
    expect(JSON.parse(out[0]!)).toEqual({ agentId: "a1", error: "interrupted" });
    expect(err).toEqual(["interrupted: stopped waiting for agent a1; the turn keeps running"]);
    expect(fake.requests.map((r) => r.type)).not.toContain(AGENT_RPC.stop);
  });

  it("send prints the id, waits for the turn and exits with its outcome", async () => {
    const fake = acceptingFake();
    const { client, ctx, out } = await connectedClient(fake.transport);
    const done = sendAgent(client, ctx, "a1", "more", {});
    await untilWaiting(fake);
    expect(out).toEqual(["a1"]);
    fake.push(settle("idle"));
    expect(await done).toBe(0);

    const failing = acceptingFake();
    const second = await connectedClient(failing.transport);
    const failed = sendAgent(second.client, second.ctx, "a1", "more", { json: true });
    await untilWaiting(failing);
    failing.push(failedRow("no key"));
    failing.push(settle("error"));
    expect(await failed).toBe(1);
    expect(JSON.parse(second.out[0]!)).toEqual({ agentId: "a1", status: "error", error: "no key" });
  });

  it("send --no-wait returns at once with the same two shapes as run", async () => {
    const fake = acceptingFake();
    const { client, ctx, out } = await connectedClient(fake.transport);
    expect(await sendAgent(client, ctx, "a1", "more", { wait: false, json: true })).toBe(0);
    expect(out).toEqual(['{"agentId":"a1"}']);
  });

  it("a refused send throws the daemon's message and starts no wait", async () => {
    const fake = makeFake({
      rpcErrors: {
        [AGENT_RPC.send]: { message: "busy: agent a1 is running", code: "handler_error" },
      },
    });
    const { client, ctx, out } = await connectedClient(fake.transport);
    await expect(sendAgent(client, ctx, "a1", "more", {})).rejects.toThrow(/^busy: agent a1/);
    expect(out).toEqual([]);
    expect(fake.requests.map((r) => r.type)).toEqual([AGENT_RPC.send]);
  });

  it("an agent archived mid-wait is closed: non-zero", async () => {
    const fake = acceptingFake();
    const { client, ctx, out, err } = await connectedClient(fake.transport);
    const done = runAgent(client, ctx, "go", { json: true });
    await untilWaiting(fake);
    fake.push({ type: "agent_archived", agentId: "a1" });
    expect(await done).toBe(1);
    expect(JSON.parse(out[0]!)).toEqual({
      agentId: "a1",
      status: "closed",
      error: "agent a1 is closed",
    });
    expect(err).toEqual(["error: agent a1 is closed"]);
  });

  it("wait on an idle agent returns at once", async () => {
    const fake = acceptingFake({ agents: [{ agentId: "a1", status: "idle" }] });
    const { client, ctx, out } = await connectedClient(fake.transport);
    expect(await waitAgent(client, ctx, "a1", {})).toBe(0);
    expect(out).toEqual(["idle"]);
  });

  it("wait on a running agent returns when its turn ends; --json prints one line", async () => {
    const fake = acceptingFake();
    const { client, ctx, out } = await connectedClient(fake.transport);
    const done = waitAgent(client, ctx, "a1", { json: true });
    await untilWaiting(fake);
    expect(await Promise.race([done, Promise.resolve("still waiting")])).toBe("still waiting");
    fake.push(settle("idle"));
    expect(await done).toBe(0);
    expect(out).toEqual(['{"agentId":"a1","status":"idle"}']);
  });

  it("wait exits non-zero for an agent that failed or is unknown", async () => {
    const failed = acceptingFake({ agents: [{ agentId: "a1", status: "error" }] });
    const one = await connectedClient(failed.transport);
    expect(await waitAgent(one.client, one.ctx, "a1", {})).toBe(1);

    const unknown = acceptingFake({ agents: [] });
    const two = await connectedClient(unknown.transport);
    expect(await waitAgent(two.client, two.ctx, "a1", {})).toBe(1);
    expect(two.err).toEqual(["error: agent a1 is closed"]);
  });

  it("wait --timeout ends a wait on a running agent non-zero", async () => {
    const running = acceptingFake();
    const { client, ctx, err } = await connectedClient(running.transport);
    vi.useFakeTimers();
    try {
      const done = waitAgent(client, ctx, "a1", { timeoutSeconds: 20 });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await done).toBe(1);
      expect(err[0]).toContain("still running after 20 s");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("wait outcomes and --timeout parsing", () => {
  it("parseTimeoutSeconds takes a positive number only", () => {
    expect(parseTimeoutSeconds("90")).toBe(90);
    expect(parseTimeoutSeconds("0.5")).toBe(0.5);
    for (const bad of ["0", "-1", "soon", "", "Infinity"]) {
      expect(() => parseTimeoutSeconds(bad)).toThrow("positive number of seconds");
    }
  });

  it("settledOutcome: only idle exits 0", () => {
    expect(settledOutcome("a1", "idle", undefined)).toEqual({
      code: 0,
      report: { agentId: "a1", status: "idle" },
    });
    expect(settledOutcome("a1", "error", "boom").code).toBe(1);
    expect(settledOutcome("a1", "closed", undefined).code).toBe(1);
  });

  it("unsettledOutcome keeps the connection's own message for other failures", () => {
    expect(unsettledOutcome("a1", new Error("the connection closed")).report).toEqual({
      agentId: "a1",
      error: "the connection closed",
    });
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

  it("compactAgent waits past the CLI's default RPC timeout for a slow compaction", async () => {
    vi.useFakeTimers();
    try {
      const fake = makeFake({
        responses: { [AGENT_RPC.compact]: { summary: "done", tokensBefore: 500 } },
      });
      const { client, ctx, out } = await connectedClient(fake.transport); // rpcTimeoutMs: 50
      const deliver = fake.transport.onMessage;
      fake.transport.onMessage = (data) => {
        if (typeof data === "string" && data.includes("agent_compact_response")) {
          setTimeout(() => deliver?.(data), 150);
        } else {
          deliver?.(data);
        }
      };
      const pending = compactAgent(client, ctx, "a1", undefined, {});
      await vi.advanceTimersByTimeAsync(150);
      expect(await pending).toBe(0);
      expect(out[0]).toContain("done");
    } finally {
      vi.useRealTimers();
    }
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

  it("listAgentCommands renders a name/source/scope/description table and forwards agentId", async () => {
    const fake = makeFake({
      responses: {
        [AGENT_RPC.listCommands]: {
          commands: [
            {
              name: "fix-tests",
              description: "Fix failing tests",
              source: "prompt",
              scope: "project",
              path: "/w/.pi/agent/prompts/fix-tests.md",
            },
          ],
        },
      },
    });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await listAgentCommands(client, ctx, "a1", {});
    expect(code).toBe(0);
    expect(out[0]).toContain("NAME");
    expect(out[0]).toContain("fix-tests");
    expect(out[0]).toContain("prompt");
    expect(out[0]).toContain("project");
    // `path` is intentionally not a table column (only `--json` carries it).
    expect(out[0]).not.toContain(".pi/agent/prompts");
    const req = fake.requests.find((r) => r.type === AGENT_RPC.listCommands)!;
    expect(req.msg.agentId).toBe("a1");
  });

  it("listAgentCommands prints (no results) for an empty command list", async () => {
    const fake = makeFake({ responses: { [AGENT_RPC.listCommands]: { commands: [] } } });
    const { client, ctx, out } = await connectedClient(fake.transport);
    const code = await listAgentCommands(client, ctx, "a1", {});
    expect(code).toBe(0);
    expect(out[0]).toBe("(no results)");
  });
});

describe("requests that are slow by nature use the SDK's named timeouts", () => {
  it("session starts and Pi commands do not run on the 30 s default", async () => {
    const fake = makeFake();
    const { client, ctx } = await connectedClient(fake.transport);
    const spy = vi.spyOn(client, "request");
    await newAgentSession(client, ctx, "a1", {});
    await switchAgentSession(client, ctx, "a1", "/tmp/s.jsonl", {});
    await forkAgent(client, ctx, "a1", "e1", {});
    await forkMessagesAgent(client, ctx, "a1", {});
    await cloneAgentSession(client, ctx, "a1", {});
    await listAgentCommands(client, ctx, "a1", {});
    const timeoutOf = (type: string): unknown =>
      spy.mock.calls.find(([sent]) => sent === type)?.[2];
    expect(timeoutOf(AGENT_RPC.newSession)).toBe(PI_COMMAND_TIMEOUT_MS);
    expect(timeoutOf(AGENT_RPC.switchSession)).toBe(PI_COMMAND_TIMEOUT_MS);
    expect(timeoutOf(AGENT_RPC.fork)).toBe(SESSION_START_TIMEOUT_MS);
    expect(timeoutOf(AGENT_RPC.forkMessages)).toBe(SESSION_START_TIMEOUT_MS);
    expect(timeoutOf(AGENT_RPC.clone)).toBe(SESSION_START_TIMEOUT_MS);
    expect(timeoutOf(AGENT_RPC.listCommands)).toBe(SESSION_START_TIMEOUT_MS);
  });
});
