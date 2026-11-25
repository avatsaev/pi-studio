import { describe, expect, it } from "vitest";

import { AgentManager } from "./agent-manager.js";
import { AgentService, getTimeline } from "./agent-service.js";
import { PiAgentClient } from "./providers/pi/agent.js";
import type { PiRpcTransport, PiTransportSpawnArgs } from "./providers/pi/rpc-transport.js";

/**
 * A Pi process that ends, for any reason, ends its turn and is replaced on the next message
 * (sprint-149/task-001). Real `PiAgentClient` and `AgentService` over a fake transport: `onPrompt`
 * says what the process does with a prompt, `die` is the `error` frame the real transport emits
 * when the process is gone (`rpc-transport.ts` `failAll`).
 */

const NOW = "2026-11-25T12:00:00.000Z";
const SESSION_FILE = "/tmp/pi-recovery-session.jsonl";

type Behaviour = "complete" | { dies: string };

class FakeProcess implements PiRpcTransport {
  readonly notifies: string[] = [];
  closed = false;
  private readonly eventCbs = new Set<(e: unknown) => void>();

  constructor(
    readonly spawnArgs: PiTransportSpawnArgs,
    /** What the process does with each prompt it gets, in order; it completes any later one. */
    private readonly onPrompts: Behaviour[],
  ) {}

  request(command: string): Promise<unknown> {
    if (command === "get_state") return Promise.resolve({ sessionFile: SESSION_FILE });
    return Promise.resolve({ cancelled: false });
  }

  notify(command: string): void {
    this.notifies.push(command);
    if (command !== "prompt") return;
    const behaviour = this.onPrompts.shift() ?? "complete";
    queueMicrotask(() => {
      this.fire({ type: "agent_start" });
      if (behaviour === "complete") this.fire({ type: "agent_settled" });
      else this.die(behaviour.dies);
    });
  }

  onEvent(cb: (e: unknown) => void): () => void {
    this.eventCbs.add(cb);
    return () => this.eventCbs.delete(cb);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  die(message: string): void {
    this.fire({ type: "error", error: message });
  }

  private fire(event: unknown): void {
    for (const cb of this.eventCbs) cb(event);
  }
}

/** `behaviours[n]` is the prompt script of the n-th Pi process the client spawns. */
function setup(behaviours: Behaviour[][]): {
  service: AgentService;
  manager: AgentManager;
  processes: FakeProcess[];
} {
  const processes: FakeProcess[] = [];
  const client = new PiAgentClient({
    command: ["pi", "--mode", "rpc"],
    binaryResolver: () => true,
    transportFactory: (args) => {
      const process = new FakeProcess(args, behaviours[processes.length] ?? []);
      processes.push(process);
      return process;
    },
  });
  const manager = new AgentManager({
    home: "/unused",
    saveAgent: () => Promise.resolve(),
    loadAllAgents: () => Promise.resolve([]),
    now: () => NOW,
  });
  const service = new AgentService({
    manager,
    resolveClient: () => client,
    broadcast: () => {},
    now: () => NOW,
  });
  return { service, manager, processes };
}

async function createAgent(service: AgentService, prompt?: string): Promise<string> {
  const result = (await service.handleCreate(
    { config: { provider: "pi", cwd: "/work" }, ...(prompt ? { initialPrompt: prompt } : {}) },
    () => [],
  )) as { payload: { agentId: string } };
  return result.payload.agentId;
}

function lastEvents(agentId: string, count: number): unknown[] {
  return (
    getTimeline(agentId)
      ?.allRows()
      .slice(-count)
      .map((row) => row.event) ?? []
  );
}

describe.each([
  ["a signal", "pi process exited (code null, SIGKILL)"],
  ["an unrequested exit 0", "pi process exited (code 0)"],
])("Pi ends by %s", (_label, reason) => {
  it("fails the turn with the reason, resolves the send, and detaches the session", async () => {
    const { service, manager, processes } = setup([["complete", { dies: reason }]]);
    const agentId = await createAgent(service, "first");
    expect(manager.get(agentId)?.record.lastStatus).toBe("idle");

    const response = await service.handleSendPrompt({ agentId, prompt: "second" }, () => []);

    expect(response).toMatchObject({ type: "agent_prompt_response", agentId });
    expect(lastEvents(agentId, 1)).toEqual([{ kind: "turn_failed", error: reason }]);
    expect(manager.get(agentId)?.record.lastStatus).toBe("error");
    expect(manager.get(agentId)?.session).toBeNull();
    expect(processes).toHaveLength(1);
  });

  it("starts a fresh Pi on the same session file at the next message", async () => {
    const { service, manager, processes } = setup([[{ dies: reason }], ["complete"]]);
    const agentId = await createAgent(service, "first");
    expect(manager.get(agentId)?.record.lastStatus).toBe("error");

    await service.handleSendPrompt({ agentId, prompt: "again" }, () => []);

    expect(processes).toHaveLength(2);
    expect(processes[1]?.spawnArgs.sessionFile).toBe(SESSION_FILE);
    expect(processes[1]?.notifies).toContain("prompt");
    expect(manager.get(agentId)?.record.lastStatus).toBe("idle");
    expect(manager.get(agentId)?.session).not.toBeNull();
    expect(lastEvents(agentId, 1)).toEqual([{ kind: "turn_completed" }]);
  });

  it("between turns it detaches the session and marks the agent error without a turn_failed", async () => {
    const { service, manager, processes } = setup([[], []]);
    const agentId = await createAgent(service, "first");
    const rowsBefore = getTimeline(agentId)?.allRows().length;

    processes[0]?.die(reason);
    await new Promise((resolve) => setImmediate(resolve));

    expect(manager.get(agentId)?.session).toBeNull();
    expect(manager.get(agentId)?.record.lastStatus).toBe("error");
    expect(getTimeline(agentId)?.allRows().length).toBe(rowsBefore);

    await service.handleSendPrompt({ agentId, prompt: "again" }, () => []);
    expect(processes).toHaveLength(2);
    expect(manager.get(agentId)?.record.lastStatus).toBe("idle");
  });
});

describe("a requested close", () => {
  it("archive closes the session without a turn_failed or an error status", async () => {
    const { service, manager, processes } = setup([[]]);
    const agentId = await createAgent(service, "first");
    const rowsBefore = getTimeline(agentId)?.allRows().length;

    await manager.archiveAgent(agentId);
    processes[0]?.die("pi process exited (code null, SIGTERM)"); // the exit close() asked for

    expect(processes[0]?.closed).toBe(true);
    expect(getTimeline(agentId)?.allRows().length).toBe(rowsBefore);
    expect(manager.get(agentId)?.record.lastStatus).toBe("idle");
  });

  it("shutdown (closeAll) does the same", async () => {
    const { service, manager, processes } = setup([[]]);
    const agentId = await createAgent(service, "first");
    const rowsBefore = getTimeline(agentId)?.allRows().length;

    await manager.closeAll();
    processes[0]?.die("pi process exited (code null, SIGTERM)");
    await new Promise((resolve) => setImmediate(resolve));

    expect(getTimeline(agentId)?.allRows().length).toBe(rowsBefore);
    expect(manager.get(agentId)?.record.lastStatus).toBe("idle");
  });
});
