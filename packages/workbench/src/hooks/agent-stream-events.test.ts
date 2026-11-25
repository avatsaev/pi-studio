import { beforeEach, describe, expect, it } from "vitest";
import type { PiStudioClient } from "@av-pi-studio/client";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import type { QueryClient } from "@tanstack/react-query";
import { useSessionStore } from "../stores/session-store.js";
import { useStatsStore } from "../stores/stats-store.js";
import { EMPTY_TIMELINE } from "../timeline/reducer.js";
import { applyAgentStreamEvent } from "./agent-stream-events.js";

function apply(event: AgentStreamEvent): void {
  applyAgentStreamEvent({
    sessionId: "s1",
    event,
    client: {} as PiStudioClient,
    queryClient: {} as QueryClient,
  });
}

const completed = (estimatedTokensAfter?: number): AgentStreamEvent => ({
  kind: "compaction",
  compactionId: "c1",
  phase: "completed",
  tokensBefore: 168_000,
  estimatedTokensAfter,
});

beforeEach(() => useStatsStore.setState({ bySession: {} }));

describe("applyAgentStreamEvent — compaction estimate", () => {
  it("a completed compaction seeds an estimated 0-100 context percent from the known window", () => {
    useStatsStore.getState().setStats("s1", {
      contextTokens: 168_000,
      contextWindow: 200_000,
      contextPercent: 84,
    });
    apply(completed(14_000));
    expect(useStatsStore.getState().bySession["s1"]).toMatchObject({
      contextTokens: 14_000,
      contextPercent: 7,
      contextEstimated: true,
    });
  });

  it("clears the stale pre-compaction percent when the window is unknown", () => {
    useStatsStore.getState().setStats("s1", { contextTokens: 168_000, contextPercent: 84 });
    apply(completed(14_000));
    const stats = useStatsStore.getState().bySession["s1"];
    expect(stats?.contextTokens).toBe(14_000);
    expect(stats?.contextPercent).toBeUndefined();
  });

  it("ignores started, failed, and estimate-less completed events", () => {
    useStatsStore.getState().setStats("s1", { contextTokens: 5 });
    apply({ kind: "compaction", compactionId: "c1", phase: "started" });
    apply({ kind: "compaction", compactionId: "c1", phase: "failed", error: "x" });
    apply(completed(undefined));
    expect(useStatsStore.getState().bySession["s1"]).toEqual({ contextTokens: 5 });
  });
});

const status = (): string | undefined => useSessionStore.getState().sessions["s1"]?.status;
const agentUpdate = (value: string): void =>
  useSessionStore.getState().applyStatusSignalByAgentId("a1", { source: "update", status: value });

describe("applyAgentStreamEvent — session status", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
    useSessionStore.getState().hydrate({
      id: "s1",
      agentId: "a1",
      title: "Chat",
      status: "idle",
      cwd: "/work",
      timeline: EMPTY_TIMELINE,
      userMessageCount: 0,
    });
  });

  it("a normal turn: running until the update, idle only when it arrives", () => {
    agentUpdate("running");
    apply({ kind: "user_message", text: "hi", messageId: "m1" });
    apply({ kind: "turn_started" });
    expect(status()).toBe("running");
    apply({ kind: "assistant_message", text: "hello" });
    apply({ kind: "turn_completed" });
    // The daemon still holds the agent's busy claim: a Send now would be refused.
    expect(status()).toBe("running");
    agentUpdate("idle");
    expect(status()).toBe("idle");
  });

  it("a slash command an extension handles inline: running then idle, no turn_* event", () => {
    agentUpdate("running");
    apply({ kind: "user_message", text: "/ext", messageId: "m1" });
    expect(status()).toBe("running");
    agentUpdate("idle");
    expect(status()).toBe("idle");
  });

  it("a failure before the turn: turn_failed shows its reason, the update settles error", () => {
    agentUpdate("running");
    apply({ kind: "user_message", text: "hi", messageId: "m1" });
    apply({ kind: "turn_failed", error: "403 forbidden" });
    expect(status()).toBe("running");
    expect(useSessionStore.getState().sessions["s1"]?.timeline.rows.at(-1)).toMatchObject({
      kind: "error",
      text: "403 forbidden",
    });
    agentUpdate("error");
    expect(status()).toBe("error");
  });

  it("a cancel stays running until the update ends it idle", () => {
    agentUpdate("running");
    apply({ kind: "turn_started" });
    apply({ kind: "turn_canceled" });
    expect(status()).toBe("running");
    agentUpdate("idle");
    expect(status()).toBe("idle");
  });

  it("an update without a turn status leaves the status alone", () => {
    agentUpdate("running");
    agentUpdate("initializing");
    expect(status()).toBe("running");
    useSessionStore
      .getState()
      .applyStatusSignalByAgentId("a1", { source: "update", status: undefined });
    expect(status()).toBe("running");
  });

  it("an event for a session that is gone changes nothing", () => {
    useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
    expect(() => apply({ kind: "turn_started" })).not.toThrow();
    expect(useSessionStore.getState().sessions).toEqual({});
  });
});
