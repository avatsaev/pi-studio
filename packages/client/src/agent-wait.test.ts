import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionMessage } from "@av-pi-studio/protocol";

import {
  settledByListing,
  settledByMessage,
  settledStatusOf,
  WaitForIdleConnectionClosedError,
  WaitForIdleTimeoutError,
} from "./agent-wait.js";
import type { DaemonClient, SessionMessageHandler, StateChangeHandler } from "./daemon-client.js";
import { RpcError } from "./daemon-client.js";
import * as clientIndex from "./index.js";
import { makeFacade } from "./test-support/scripted-daemon.js";

function asMessage(message: Record<string, unknown>): SessionMessage {
  return message as unknown as SessionMessage;
}

/** What a promise did, readable without awaiting it. */
interface Outcome<T> {
  settled: boolean;
  value?: T;
  error?: unknown;
}

function track<T>(promise: Promise<T>): Outcome<T> {
  const outcome: Outcome<T> = { settled: false };
  promise.then(
    (value) => {
      outcome.settled = true;
      outcome.value = value;
    },
    (error: unknown) => {
      outcome.settled = true;
      outcome.error = error;
    },
  );
  return outcome;
}

/** Lets every queued microtask run (the fake clock is on; no real time passes). */
function flush(): Promise<void> {
  return vi.advanceTimersByTimeAsync(0);
}

/** Counts the session-message and state-change listeners `daemon` holds from now on. */
function trackListeners(daemon: DaemonClient): () => number {
  let active = 0;
  const onSessionMessage = daemon.onSessionMessage.bind(daemon);
  const onStateChange = daemon.onStateChange.bind(daemon);
  const counted = (off: () => void): (() => void) => {
    active++;
    return () => {
      active--;
      off();
    };
  };
  vi.spyOn(daemon, "onSessionMessage").mockImplementation((handler: SessionMessageHandler) =>
    counted(onSessionMessage(handler)),
  );
  vi.spyOn(daemon, "onStateChange").mockImplementation((handler: StateChangeHandler) =>
    counted(onStateChange(handler)),
  );
  return () => active;
}

/** A facade whose turns stay `running` until the test settles them, with one running agent. */
async function withRunningAgent() {
  const facade = await makeFacade({ holdTurns: true });
  const { agentId } = await facade.client.createAgent({
    config: { provider: "mock", cwd: "/w" },
    initialPrompt: "go",
    labels: {},
  });
  return { ...facade, agentId, agent: facade.client.agent(agentId) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("settledStatusOf", () => {
  it("ends a wait for idle, error and closed", () => {
    expect(settledStatusOf("idle")).toBe("idle");
    expect(settledStatusOf("error")).toBe("error");
    expect(settledStatusOf("closed")).toBe("closed");
  });

  it("does not end a wait for running, initializing, a missing or an unknown status", () => {
    expect(settledStatusOf("running")).toBeNull();
    expect(settledStatusOf("initializing")).toBeNull();
    expect(settledStatusOf(undefined)).toBeNull();
    expect(settledStatusOf("bogus")).toBeNull();
  });
});

describe("settledByMessage", () => {
  it("reads the status of this agent's agent_update", () => {
    const update = (status?: string) => asMessage({ type: "agent_update", agentId: "a1", status });
    expect(settledByMessage("a1", update("idle"))).toBe("idle");
    expect(settledByMessage("a1", update("error"))).toBe("error");
    expect(settledByMessage("a1", update("running"))).toBeNull();
    expect(settledByMessage("a1", update())).toBeNull(); // a title or label change
  });

  it("ignores another agent's agent_update, archive and delete", () => {
    expect(
      settledByMessage("a1", asMessage({ type: "agent_update", agentId: "a2", status: "idle" })),
    ).toBeNull();
    expect(settledByMessage("a1", asMessage({ type: "agent_archived", agentId: "a2" }))).toBeNull();
    expect(settledByMessage("a1", asMessage({ type: "agent_deleted", agentId: "a2" }))).toBeNull();
  });

  it("reads this agent's archive and delete as closed", () => {
    expect(settledByMessage("a1", asMessage({ type: "agent_archived", agentId: "a1" }))).toBe(
      "closed",
    );
    expect(settledByMessage("a1", asMessage({ type: "agent_deleted", agentId: "a1" }))).toBe(
      "closed",
    );
  });

  it("ignores every other message type", () => {
    expect(
      settledByMessage("a1", asMessage({ type: "agent_status", agentId: "a1", status: "idle" })),
    ).toBeNull();
    expect(
      settledByMessage("a1", asMessage({ type: "workspace_update", workspaceId: "a1" })),
    ).toBeNull();
  });
});

describe("settledByListing", () => {
  const agents = [
    { agentId: "a1", status: "running" },
    { agentId: "a2", status: "idle" },
    { agentId: "a3", status: "error" },
    { agentId: "a4", status: "initializing" },
    { agentId: "a5" },
  ];

  it("reads the listed agent's status", () => {
    expect(settledByListing("a1", agents)).toBeNull();
    expect(settledByListing("a2", agents)).toBe("idle");
    expect(settledByListing("a3", agents)).toBe("error");
    expect(settledByListing("a4", agents)).toBeNull();
    expect(settledByListing("a5", agents)).toBeNull();
  });

  it("reads an agent the listing leaves out as closed", () => {
    expect(settledByListing("gone", agents)).toBe("closed");
    expect(settledByListing("gone", [])).toBe("closed");
  });
});

describe("AgentHandle.waitForIdle", () => {
  it("is reachable from the package root", () => {
    expect(clientIndex.WaitForIdleTimeoutError).toBe(WaitForIdleTimeoutError);
    expect(clientIndex.waitForAgentIdle).toBeTypeOf("function");
  });

  it("resolves at once on an idle agent", async () => {
    const { client, fake } = await makeFacade();
    const { agentId } = await client.createAgent({
      config: { provider: "mock", cwd: "/w" },
      labels: {},
    });

    await expect(client.agent(agentId).waitForIdle()).resolves.toEqual({ status: "idle" });
    expect(fake.sent.filter((m) => m.type === "list_agents_request")).toHaveLength(1);
  });

  it("resolves at once on an agent that already ended its turn in error", async () => {
    const { agent, fake, agentId } = await withRunningAgent();
    fake.settle(agentId, "error");

    await expect(agent.waitForIdle()).resolves.toEqual({ status: "error" });
  });

  it("resolves idle when the turn it waits for settles idle", async () => {
    const { agent, fake, agentId } = await withRunningAgent();
    const outcome = track(agent.waitForIdle());
    await flush();
    expect(outcome.settled).toBe(false);

    fake.settle(agentId, "idle");
    await flush();
    expect(outcome.value).toEqual({ status: "idle" });
  });

  it("resolves error after an agent_update error", async () => {
    const { agent, fake, agentId } = await withRunningAgent();
    const outcome = track(agent.waitForIdle());
    await flush();

    fake.settle(agentId, "error");
    await flush();
    expect(outcome.value).toEqual({ status: "error" });
  });

  it("keeps waiting through running and status-less updates, and through other agents", async () => {
    const { agent, fake, agentId } = await withRunningAgent();
    const outcome = track(agent.waitForIdle());
    await flush();

    fake.push({ type: "agent_update", agentId, status: "running" });
    fake.push({ type: "agent_update", agentId, title: "Renamed" });
    fake.push({ type: "agent_update", agentId: "other", status: "idle" });
    fake.push({ type: "agent_archived", agentId: "other" });
    await flush();
    expect(outcome.settled).toBe(false);

    fake.settle(agentId, "idle");
    await flush();
    expect(outcome.value).toEqual({ status: "idle" });
  });

  it("resolves closed when the agent is archived", async () => {
    const { agent, fake, agentId } = await withRunningAgent();
    const outcome = track(agent.waitForIdle());
    await flush();

    fake.push({ type: "agent_archived", agentId });
    await flush();
    expect(outcome.value).toEqual({ status: "closed" });
  });

  it("resolves closed when the agent is deleted", async () => {
    const { agent, fake, agentId } = await withRunningAgent();
    const outcome = track(agent.waitForIdle());
    await flush();

    fake.push({ type: "agent_deleted", agentId });
    await flush();
    expect(outcome.value).toEqual({ status: "closed" });
  });

  it("resolves closed for an agent the daemon does not list", async () => {
    const { client } = await makeFacade();

    await expect(client.agent("ghost").waitForIdle()).resolves.toEqual({ status: "closed" });
  });

  it("is not fooled by a settle that lands between the subscription and the status read", async () => {
    const { agent, fake, agentId, daemon } = await withRunningAgent();
    // Hold the daemon's answer to the status read: it was taken while the agent ran.
    const deliver = fake.transport.onMessage;
    const held: string[] = [];
    fake.transport.onMessage = (data) => {
      if (typeof data === "string" && data.includes("list_agents_response")) held.push(data);
      else deliver?.(data);
    };
    const listeners = trackListeners(daemon);

    const outcome = track(agent.waitForIdle());
    await flush();
    expect(held).toHaveLength(1);
    expect(outcome.settled).toBe(false);

    fake.settle(agentId, "idle"); // arrives before the (stale) answer to the read
    await flush();
    expect(outcome.value).toEqual({ status: "idle" });

    for (const frame of held) deliver?.(frame); // the stale answer is ignored, not a crash
    await flush();
    expect(outcome.value).toEqual({ status: "idle" });
    expect(listeners()).toBe(0);
  });

  it("rejects with WaitForIdleTimeoutError after timeoutMs and removes its listeners", async () => {
    const { agent, daemon, agentId } = await withRunningAgent();
    const listeners = trackListeners(daemon);

    const outcome = track(agent.waitForIdle({ timeoutMs: 5000 }));
    await vi.advanceTimersByTimeAsync(4999);
    expect(outcome.settled).toBe(false);
    expect(listeners()).toBe(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.error).toBeInstanceOf(WaitForIdleTimeoutError);
    expect(outcome.error).toMatchObject({ agentId, timeoutMs: 5000 });
    expect(listeners()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timer when the agent settles first", async () => {
    const { agent, fake, agentId } = await withRunningAgent();

    const outcome = track(agent.waitForIdle({ timeoutMs: 5000 }));
    await flush();
    fake.settle(agentId, "idle");
    await flush();

    expect(outcome.value).toEqual({ status: "idle" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with an AbortError when the signal aborts, and removes its listeners", async () => {
    const { agent, daemon } = await withRunningAgent();
    const listeners = trackListeners(daemon);
    const controller = new AbortController();

    const outcome = track(agent.waitForIdle({ signal: controller.signal }));
    await flush();
    expect(listeners()).toBe(2);

    controller.abort();
    await flush();
    expect(outcome.error).toMatchObject({ name: "AbortError" });
    expect(listeners()).toBe(0);
  });

  it("rejects at once, sending nothing, when the signal is already aborted", async () => {
    const { agent, fake } = await withRunningAgent();
    const sentBefore = fake.sent.length;

    await expect(agent.waitForIdle({ signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fake.sent).toHaveLength(sentBefore);
  });

  it("rejects with WaitForIdleConnectionClosedError when the connection closes", async () => {
    const { agent, fake, daemon, agentId } = await withRunningAgent();
    const listeners = trackListeners(daemon);

    const outcome = track(agent.waitForIdle());
    await flush();
    fake.drop();
    await flush();

    expect(outcome.error).toBeInstanceOf(WaitForIdleConnectionClosedError);
    expect(outcome.error).toMatchObject({ agentId });
    expect(listeners()).toBe(0);
  });

  it("names the closed connection, not the lost read, when it closes during the status read", async () => {
    const { agent, fake } = await withRunningAgent();

    const outcome = track(agent.waitForIdle());
    fake.drop(); // before the daemon's answer to the read could arrive
    await flush();

    expect(outcome.error).toBeInstanceOf(WaitForIdleConnectionClosedError);
  });

  it("rejects at once on a connection that is already closed", async () => {
    const { agent, fake } = await withRunningAgent();
    fake.drop();

    await expect(agent.waitForIdle()).rejects.toBeInstanceOf(WaitForIdleConnectionClosedError);
  });

  it("rejects with the error of a failed status read and removes its listeners", async () => {
    const { agent, daemon } = await withRunningAgent();
    const listeners = trackListeners(daemon);
    const refused = new RpcError("shutting down", "r1", "shutting_down");
    vi.spyOn(daemon, "request").mockRejectedValueOnce(refused);

    await expect(agent.waitForIdle()).rejects.toBe(refused);
    expect(listeners()).toBe(0);
  });
});
