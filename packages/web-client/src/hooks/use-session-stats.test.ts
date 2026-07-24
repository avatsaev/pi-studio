import { beforeEach, describe, expect, it } from "vitest";
import { applySessionStats, shouldRepollOnStatusChange } from "./use-session-stats.js";
import { useStatsStore } from "@pi-studio-ui/stores/stats-store.js";
import { useSessionStore, type SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { EMPTY_TIMELINE } from "@pi-studio-ui/timeline/reducer.js";
import type { AgentSessionStatsResponse } from "@av-pi-studio/protocol";

function hydrated(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: "s1",
    agentId: "a1",
    title: "Test",
    status: "idle",
    cwd: "/work",
    timeline: EMPTY_TIMELINE,
    userMessageCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  useStatsStore.setState({ bySession: {} });
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
});

describe("shouldRepollOnStatusChange", () => {
  it("is true when a turn just ended (running -> idle/error/anything else)", () => {
    expect(shouldRepollOnStatusChange("running", "idle")).toBe(true);
    expect(shouldRepollOnStatusChange("running", "error")).toBe(true);
  });

  it("is false while still running, or when it was never running", () => {
    expect(shouldRepollOnStatusChange("running", "running")).toBe(false);
    expect(shouldRepollOnStatusChange("idle", "running")).toBe(false);
    expect(shouldRepollOnStatusChange(undefined, "running")).toBe(false);
    expect(shouldRepollOnStatusChange("idle", "idle")).toBe(false);
  });
});

describe("applySessionStats", () => {
  it("maps the RPC payload onto stats-store's flatter shape", () => {
    const payload: AgentSessionStatsResponse["payload"] = {
      tokens: { input: 100, output: 50, total: 150 },
      contextUsage: { tokens: 500, contextWindow: 200_000, percent: 0.0025 },
      cost: 0.04,
      model: "opus",
    };
    applySessionStats("s1", payload);
    expect(useStatsStore.getState().bySession["s1"]).toEqual({
      contextTokens: 500,
      contextWindow: 200_000,
      contextPercent: 0.0025,
      totalTokens: 150,
      inputTokens: 100,
      outputTokens: 50,
      cost: 0.04,
      model: "opus",
    });
  });

  it("maps an empty payload to all-undefined fields (merged, not cleared)", () => {
    useStatsStore.getState().setStats("s1", { model: "sonnet" });
    applySessionStats("s1", {});
    // setStats merges — an empty payload's undefined fields don't erase the prior model.
    expect(useStatsStore.getState().bySession["s1"]?.model).toBe("sonnet");
  });

  it("a null contextUsage.tokens/percent (Pi's null-when-unknown convention) maps to undefined", () => {
    applySessionStats("s1", { contextUsage: { tokens: null, percent: null, contextWindow: 200_000 } });
    const s = useStatsStore.getState().bySession["s1"];
    expect(s?.contextTokens).toBeUndefined();
    expect(s?.contextPercent).toBeUndefined();
    expect(s?.contextWindow).toBe(200_000);
  });

  it("reconciles session-store's model too — the status bar's segment reads SessionEntry.model, not stats-store", () => {
    useSessionStore.getState().hydrate(hydrated({ id: "s1", agentId: "a1" }));
    applySessionStats("s1", { model: "opus" });
    expect(useSessionStore.getState().sessions["s1"]?.model).toBe("opus");
  });

  it("does not touch session-store when the payload omits model", () => {
    useSessionStore.getState().hydrate(hydrated({ id: "s1", agentId: "a1", model: "sonnet" }));
    applySessionStats("s1", { cost: 0.01 });
    expect(useSessionStore.getState().sessions["s1"]?.model).toBe("sonnet");
  });
});
