import { beforeEach, describe, expect, it } from "vitest";
import type { PiStudioClient } from "@av-pi-studio/client";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import type { QueryClient } from "@tanstack/react-query";
import { useStatsStore } from "@pi-studio-ui/stores/stats-store.js";
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
