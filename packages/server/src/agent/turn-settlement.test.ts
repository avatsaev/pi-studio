import { randomUUID } from "node:crypto";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { describe, expect, it, vi } from "vitest";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import { AgentManager } from "./agent-manager.js";
import { AgentService, getTimeline } from "./agent-service.js";
import { MOCK_CAPABILITIES } from "./providers/mock/mock-provider.js";
import type { AgentClient, AgentSession, Unsubscribe } from "./provider-contract.js";

/**
 * `runTurn` regression (sprint-041-agent-turn-settlement, task-002): proves the actual reported
 * failure — an interim (retried/continued) run's terminal-shaped event used to resolve
 * `session.run()` early, tearing down `runTurn`'s subscription (`unsubscribe()`), flipping status
 * to `idle`, and archiving mid-turn — is closed now that a fixed provider only resolves `run()` at
 * the true settlement (task-001).
 */

const NOW = "2026-06-11T12:00:00.000Z";

/**
 * A fake `AgentSession` that scripts Pi's real retry/continuation shape: `run()` streams an
 * interim run's rows and stays pending — no terminal — until the test drives
 * `continueAfterRetry()`, which streams a second run's rows and the single true terminal, then
 * resolves `run()`. Deterministic (no timers): this is the async gap a real retried Pi turn has
 * (`agent_end{willRetry:true}` → … → `agent_end{willRetry:false}` → `agent_settled`), made
 * test-controllable instead of timer-driven.
 */
class RetryAgentSession implements AgentSession {
  readonly provider = "mock";
  readonly id = randomUUID();
  readonly capabilities = MOCK_CAPABILITIES;

  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private resolveRun: (() => void) | undefined;

  private emit(event: AgentStreamEvent): void {
    for (const cb of this.subscribers) cb(event);
  }

  subscribe(cb: (event: AgentStreamEvent) => void): Unsubscribe {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  startTurn(): Promise<{ turnId: string }> {
    return Promise.resolve({ turnId: "t1" });
  }

  run(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.resolveRun = resolve;
      this.emit({ kind: "turn_started" });
      this.emit({ kind: "assistant_message", text: "attempt 1", final: true });
      // No terminal here — mirrors an interim `agent_end{willRetry:true}`. `run()` MUST NOT
      // resolve until `continueAfterRetry()` streams the real terminal below.
    });
  }

  /** Test control: the retried run's rows, the single true terminal, then resolve `run()`. */
  continueAfterRetry(): void {
    this.emit({ kind: "assistant_message", text: "attempt 2", final: true });
    this.emit({ kind: "turn_completed" });
    this.resolveRun?.();
  }

  interrupt(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  getRuntimeInfo() {
    return { provider: this.provider, sessionId: this.id, model: "mock" };
  }

  getAvailableModes() {
    return [];
  }

  getCurrentMode(): string | null {
    return null;
  }

  setMode(): Promise<void> {
    return Promise.resolve();
  }

  getPendingPermissions() {
    return [];
  }

  respondToPermission(): Promise<void> {
    return Promise.resolve();
  }

  describePersistence() {
    return null;
  }
}

function makeService(session: AgentSession) {
  const broadcasts: Record<string, unknown>[] = [];
  const manager = new AgentManager({
    home: "/unused",
    saveAgent: () => Promise.resolve(),
    loadAllAgents: () => Promise.resolve([]),
    now: () => NOW,
  });
  const archiveAgent = vi.spyOn(manager, "archiveAgent").mockResolvedValue(undefined);
  const client: AgentClient = {
    provider: "mock",
    capabilities: MOCK_CAPABILITIES,
    createSession: () => Promise.resolve(session),
    resumeSession: () => Promise.resolve(session),
    listModels: () => Promise.resolve([]),
    isAvailable: () => true,
  };
  const service = new AgentService({
    manager,
    resolveClient: () => client,
    broadcast: (_sessions, msg) => broadcasts.push(msg as Record<string, unknown>),
    now: () => NOW,
  });
  return { service, manager, broadcasts, archiveAgent };
}

describe("sprint-041 regression: runTurn stays subscribed and settles once across a retried turn", () => {
  it("no premature idle status, no lost post-interim rows, exactly one autoArchive — all gated on the true terminal", async () => {
    const session = new RetryAgentSession();
    const { service, manager, broadcasts, archiveAgent } = makeService(session);

    const record: AgentRecord = {
      id: randomUUID(),
      provider: "mock",
      cwd: "/work",
      createdAt: NOW,
      updatedAt: NOW,
      labels: {},
      lastStatus: "initializing",
      config: { provider: "mock", cwd: "/work" },
      timeline: [],
    };
    await manager.add(record);
    await manager.setStatus(record.id, "idle");
    manager.attachSession(record.id, session);

    const running = service.runTurn(record.id, session, "do it", () => [], {
      autoArchive: true,
    });

    // At this point only the interim run's rows have streamed (`RetryAgentSession.run()`
    // deliberately stays pending). Bug (sprint-041): a wrongly-terminal interim event would have
    // already resolved `run()`, unsubscribed, and flipped status to idle here.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const statusesBeforeSettle = broadcasts
      .filter((b) => b.type === "agent_update")
      .map((b) => b.status);
    expect(statusesBeforeSettle).not.toContain("idle");
    expect(archiveAgent).not.toHaveBeenCalled();
    expect(manager.get(record.id)?.record.lastStatus).toBe("running");

    session.continueAfterRetry();
    await running;

    // Every row streamed, including the post-interim ("attempt 2") ones — none lost to an early
    // unsubscribe.
    const timeline = getTimeline(record.id);
    expect(timeline!.allRows().map((r) => r.event.kind)).toEqual([
      "user_message",
      "turn_started",
      "assistant_message",
      "assistant_message",
      "turn_completed",
    ]);
    const assistantTexts: (string | undefined)[] = [];
    for (const row of timeline!.allRows()) {
      if (row.event.kind === "assistant_message") assistantTexts.push(row.event.text);
    }
    expect(assistantTexts).toEqual(["attempt 1", "attempt 2"]);

    // Status flips to idle, and archive fires, exactly once — after settlement, not the interim.
    const statuses = broadcasts.filter((b) => b.type === "agent_update").map((b) => b.status);
    expect(statuses.filter((s) => s === "idle")).toHaveLength(1);
    expect(statuses.at(-1)).toBe("idle");
    expect(archiveAgent).toHaveBeenCalledTimes(1);
    expect(archiveAgent).toHaveBeenCalledWith(record.id);
    expect(manager.get(record.id)?.record.lastStatus).toBe("idle");
  });
});
