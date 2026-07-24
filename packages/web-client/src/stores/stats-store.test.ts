import { beforeEach, describe, expect, it } from "vitest";
import { useStatsStore } from "./stats-store.js";

beforeEach(() => {
  useStatsStore.setState({ bySession: {} });
});

describe("stats store — per-session context/token/cost/model (sprint-042)", () => {
  it("setStats merges a partial update, preserving prior fields for that session", () => {
    useStatsStore.getState().setStats("s1", { contextPercent: 0.25, totalTokens: 1000 });
    useStatsStore.getState().setStats("s1", { cost: 0.04 });
    expect(useStatsStore.getState().bySession["s1"]).toEqual({
      contextPercent: 0.25,
      totalTokens: 1000,
      cost: 0.04,
    });
  });

  it("setStats keeps sessions independent", () => {
    useStatsStore.getState().setStats("s1", { model: "opus" });
    useStatsStore.getState().setStats("s2", { model: "sonnet" });
    expect(useStatsStore.getState().bySession["s1"]?.model).toBe("opus");
    expect(useStatsStore.getState().bySession["s2"]?.model).toBe("sonnet");
  });

  it("clear removes only the targeted session", () => {
    useStatsStore.getState().setStats("s1", { model: "opus" });
    useStatsStore.getState().setStats("s2", { model: "sonnet" });
    useStatsStore.getState().clear("s1");
    expect(useStatsStore.getState().bySession["s1"]).toBeUndefined();
    expect(useStatsStore.getState().bySession["s2"]?.model).toBe("sonnet");
  });

  it("clear on an unknown session is a no-op", () => {
    useStatsStore.getState().setStats("s1", { model: "opus" });
    useStatsStore.getState().clear("nope");
    expect(useStatsStore.getState().bySession["s1"]?.model).toBe("opus");
  });
});
