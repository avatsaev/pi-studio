import { describe, expect, it, vi, type Mock } from "vitest";

import { AgentManager } from "./agent-manager.js";
import { AgentService, ensureSession, getTimeline, spawnOrResumeSession } from "./agent-service.js";
import { PiAgentClient } from "./providers/pi/agent.js";
import type { PiRpcTransport, PiTransportSpawnArgs } from "./providers/pi/rpc-transport.js";
import { SessionOperationsService } from "./session-operations.js";
import type { AgentRecord } from "../persistence/entity-schemas.js";

/**
 * One Pi process per agent, and no RPC left hanging by a close (sprint-149/task-004). Real
 * `PiAgentClient`, `AgentManager` and `AgentService` over a fake transport factory that counts the
 * processes it spawns.
 */

const NOW = "2026-11-25T12:00:00.000Z";
const SESSION_FILE = "/tmp/pi-one-process-session.jsonl";

interface ProcessScript {
  /** Commands whose request rejects, e.g. `switch_session` (a failed handshake). */
  failing?: string[];
  /** A `prompt` never produces a terminal event: the turn runs until something ends it. */
  hangs?: boolean;
}

class FakeProcess implements PiRpcTransport {
  readonly notifies: string[] = [];
  closed = false;
  private readonly eventCbs = new Set<(e: unknown) => void>();
  private readonly pending = new Set<(error: Error) => void>();

  constructor(
    readonly spawnArgs: PiTransportSpawnArgs,
    private readonly script: ProcessScript,
  ) {}

  request(command: string): Promise<unknown> {
    if (this.script.failing?.includes(command))
      return Promise.reject(new Error(`${command} failed`));
    if (command === "get_state") return Promise.resolve({ sessionFile: SESSION_FILE });
    if (command === "prompt" && this.script.hangs) {
      const { promise, reject } = Promise.withResolvers<never>();
      this.pending.add(reject);
      return promise;
    }
    return Promise.resolve({ cancelled: false });
  }

  notify(command: string): void {
    this.notifies.push(command);
    if (command !== "prompt") return;
    queueMicrotask(() => {
      this.fire({ type: "agent_start" });
      if (!this.script.hangs) this.fire({ type: "agent_settled" });
    });
  }

  onEvent(cb: (e: unknown) => void): () => void {
    this.eventCbs.add(cb);
    return () => this.eventCbs.delete(cb);
  }

  close(): Promise<void> {
    this.closed = true;
    for (const reject of this.pending) reject(new Error("pi transport closed"));
    this.pending.clear();
    return Promise.resolve();
  }

  private fire(event: unknown): void {
    for (const cb of this.eventCbs) cb(event);
  }
}

function record(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    provider: "pi",
    cwd: "/work",
    createdAt: NOW,
    updatedAt: NOW,
    labels: {},
    lastStatus: "idle",
    timeline: [],
    ...overrides,
  };
}

/** A record a restarted daemon loads: a persisted handle, no live session. */
function resumable(): AgentRecord {
  return record({
    persistence: { provider: "pi", sessionId: "s", nativeHandle: SESSION_FILE },
  });
}

/** `scripts[n]` is the behaviour of the n-th Pi process the client spawns. */
async function setup(
  agent: AgentRecord | null,
  scripts: ProcessScript[] = [],
): Promise<{
  service: AgentService;
  ops: SessionOperationsService;
  manager: AgentManager;
  processes: FakeProcess[];
  saves: AgentRecord[];
  error: Mock;
  deps: ConstructorParameters<typeof SessionOperationsService>[0];
}> {
  const processes: FakeProcess[] = [];
  const saves: AgentRecord[] = [];
  const client = new PiAgentClient({
    command: ["pi", "--mode", "rpc"],
    binaryResolver: () => true,
    transportFactory: (args) => {
      const process = new FakeProcess(args, scripts[processes.length] ?? {});
      processes.push(process);
      return process;
    },
  });
  const manager = new AgentManager({
    home: "/unused",
    saveAgent: (saved) => {
      saves.push(saved);
      return Promise.resolve();
    },
    loadAllAgents: () => Promise.resolve([]),
    deleteAgent: () => Promise.resolve(true),
    now: () => NOW,
  });
  if (agent) await manager.add(agent);
  saves.length = 0;
  const error = vi.fn();
  const service = new AgentService({
    manager,
    resolveClient: () => client,
    broadcast: () => {},
    now: () => NOW,
    logger: { info: vi.fn(), warn: vi.fn(), error, debug: vi.fn() } as never,
  });
  const deps = { manager, resolveClient: () => client, service, broadcast: () => {} };
  return {
    service,
    ops: new SessionOperationsService(deps),
    manager,
    processes,
    saves,
    error,
    deps,
  };
}

describe("one spawn per agent", () => {
  it("shares one process between concurrent first callers after a restart", async () => {
    const { manager, processes, deps } = await setup(resumable());

    const [a, b, c] = await Promise.all([
      ensureSession(deps, "agent-1"),
      ensureSession(deps, "agent-1"),
      spawnOrResumeSession(deps, "agent-1"),
    ]);

    expect(processes).toHaveLength(1);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(manager.get("agent-1")?.session).toBe(a);
  });

  it("spawns one process for two concurrent first sends; the loser is refused as busy", async () => {
    const { service, processes } = await setup(resumable());
    const send = () => service.handleSendPrompt({ agentId: "agent-1", prompt: "hi" }, () => []);

    const results = await Promise.allSettled([send(), send()]);

    expect(results.map((r) => r.status).toSorted()).toEqual(["fulfilled", "rejected"]);
    expect(processes).toHaveLength(1);
  });

  it("shares the spawn of a send with a concurrent list-commands style caller", async () => {
    const { service, processes, deps } = await setup(resumable());

    await Promise.all([
      service.handleSendPrompt({ agentId: "agent-1", prompt: "hi" }, () => []),
      ensureSession(deps, "agent-1"),
    ]);

    expect(processes).toHaveLength(1);
  });

  it("spawns again after a failed spawn", async () => {
    const { processes, deps } = await setup(resumable(), [{ failing: ["switch_session"] }]);

    await expect(ensureSession(deps, "agent-1")).rejects.toThrow("switch_session failed");
    await ensureSession(deps, "agent-1");

    expect(processes).toHaveLength(2);
  });
});

describe("a replaced or failed process is closed", () => {
  it("closes the old process when resume replaces a live session", async () => {
    const { service, ops, manager, processes } = await setup(null);
    const created = (await service.handleCreate(
      { config: { provider: "pi", cwd: "/work" }, initialPrompt: "first" },
      () => [],
    )) as { payload: { agentId: string } };
    const agentId = created.payload.agentId;
    expect(processes).toHaveLength(1);
    expect(processes[0]?.closed).toBe(false);

    await ops.handleResume({ agentId }, () => []);

    expect(processes).toHaveLength(2);
    expect(processes[0]?.closed).toBe(true);
    expect(processes[1]?.closed).toBe(false);
    expect(manager.get(agentId)?.session).not.toBeNull();
  });

  it("closes the transport when the resume handshake fails", async () => {
    const { processes, deps } = await setup(resumable(), [{ failing: ["switch_session"] }]);

    await expect(spawnOrResumeSession(deps, "agent-1")).rejects.toThrow();

    expect(processes).toHaveLength(1);
    expect(processes[0]?.closed).toBe(true);
  });

  it("closes the process when replaying the pinned model fails after the spawn", async () => {
    const draft = record({
      config: { provider: "pi", cwd: "/work", model: "m", modelProvider: "p" },
    });
    const { manager, processes, deps } = await setup(draft, [{ failing: ["set_model"] }]);

    await expect(spawnOrResumeSession(deps, "agent-1")).rejects.toThrow();

    expect(processes[0]?.closed).toBe(true);
    expect(manager.get("agent-1")?.session).toBeNull();
  });

  it("closes the process when the agent was deleted while it started", async () => {
    const { manager, processes, deps } = await setup(resumable());

    const spawning = spawnOrResumeSession(deps, "agent-1");
    await manager.deleteAgent("agent-1");

    await expect(spawning).rejects.toThrow("closed while its session started");
    expect(processes[0]?.closed).toBe(true);
  });
});

describe("closing mid-turn", () => {
  /** A draft whose first prompt never ends; resolves once Pi has the prompt. */
  async function startHangingTurn() {
    const ctx = await setup(record(), [{ hangs: true }]);
    const send = ctx.service.handleSendPrompt({ agentId: "agent-1", prompt: "work" }, () => []);
    await vi.waitFor(() => expect(ctx.processes[0]?.notifies).toContain("prompt"));
    expect(ctx.manager.get("agent-1")?.record.lastStatus).toBe("running");
    return { ...ctx, send };
  }

  it("archive interrupts, ends the turn as canceled, and resolves the send", async () => {
    const { manager, processes, send, error } = await startHangingTurn();

    await manager.archiveAgent("agent-1");

    await expect(send).resolves.toMatchObject({ type: "agent_prompt_response" });
    expect(processes[0]?.notifies).toContain("abort");
    expect(processes[0]?.closed).toBe(true);
    expect(manager.get("agent-1")?.record.lastStatus).toBe("closed");
    expect(getTimeline("agent-1")?.allRows().at(-1)?.event.kind).toBe("turn_canceled");
    expect(error).not.toHaveBeenCalled();
  });

  it("delete ends the turn, resolves the send, and writes nothing back", async () => {
    const { manager, send, saves, error } = await startHangingTurn();
    const savesBefore = saves.length;

    await manager.deleteAgent("agent-1");

    await expect(send).resolves.toMatchObject({ type: "agent_prompt_response" });
    expect(manager.get("agent-1")).toBeUndefined();
    expect(saves).toHaveLength(savesBefore);
    expect(error).not.toHaveBeenCalled();
  });

  it("ends a running slash prompt without failing it", async () => {
    const processes: FakeProcess[] = [];
    const client = new PiAgentClient({
      command: ["pi", "--mode", "rpc"],
      binaryResolver: () => true,
      transportFactory: (args) => {
        const process = new FakeProcess(args, { hangs: true });
        processes.push(process);
        return process;
      },
    });
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const events: string[] = [];
    session.subscribe((event) => events.push(event.kind));

    const run = session.run("/slow");
    await session.close();

    await expect(run).resolves.toBeUndefined();
    expect(events).toEqual(["turn_canceled"]);
  });
});
