import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore, type SessionEntry } from "./session-store.js";
import { EMPTY_TIMELINE, type TimelineState } from "@pi-studio-ui/timeline/reducer.js";

beforeEach(() => {
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
});

function hydrated(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: "s1",
    agentId: "a1",
    title: "Restored",
    status: "idle",
    cwd: "/work",
    timeline: EMPTY_TIMELINE,
    userMessageCount: 0,
    ...overrides,
  };
}

function timelineWith(userRows: number): TimelineState {
  return {
    ...EMPTY_TIMELINE,
    rows: Array.from({ length: userRows }, (_, i) => ({
      kind: "user" as const,
      id: `row-${i}`,
      text: `msg ${i}`,
    })),
  };
}

describe("session store — model (sprint-042)", () => {
  it("hydrate carries the model field through unchanged", () => {
    useSessionStore.getState().hydrate(hydrated({ model: "opus" }));
    expect(useSessionStore.getState().sessions["s1"]?.model).toBe("opus");
  });

  it("hydrate without a model leaves it undefined", () => {
    useSessionStore.getState().hydrate(hydrated());
    expect(useSessionStore.getState().sessions["s1"]?.model).toBeUndefined();
  });

  it("setModel updates the session's model in place", () => {
    useSessionStore.getState().hydrate(hydrated());
    useSessionStore.getState().setModel("s1", "sonnet");
    expect(useSessionStore.getState().sessions["s1"]?.model).toBe("sonnet");
  });

  it("setModel also carries the model's own LLM provider (modelProvider)", () => {
    useSessionStore.getState().hydrate(hydrated());
    useSessionStore.getState().setModel("s1", "claude-sonnet-5", "anthropic");
    expect(useSessionStore.getState().sessions["s1"]?.model).toBe("claude-sonnet-5");
    expect(useSessionStore.getState().sessions["s1"]?.modelProvider).toBe("anthropic");
  });

  it("setModel on an unknown sessionId is a no-op", () => {
    useSessionStore.getState().setModel("nope", "sonnet");
    expect(useSessionStore.getState().sessions["nope"]).toBeUndefined();
  });

  it("setModelByAgentId resolves the owning session and updates its model", () => {
    useSessionStore.getState().hydrate(hydrated({ id: "s1", agentId: "a1" }));
    useSessionStore.getState().hydrate(hydrated({ id: "s2", agentId: "a2" }));
    useSessionStore.getState().setModelByAgentId("a2", "opus");
    expect(useSessionStore.getState().sessions["s1"]?.model).toBeUndefined();
    expect(useSessionStore.getState().sessions["s2"]?.model).toBe("opus");
  });

  it("setModelByAgentId on an unknown agentId is a no-op", () => {
    useSessionStore.getState().hydrate(hydrated());
    useSessionStore.getState().setModelByAgentId("no-such-agent", "opus");
    expect(useSessionStore.getState().sessions["s1"]?.model).toBeUndefined();
  });
});
describe("session store — thinking level (sprint-070)", () => {
  it("hydrate carries the thinkingLevel field through unchanged", () => {
    useSessionStore.getState().hydrate(hydrated({ thinkingLevel: "high" }));
    expect(useSessionStore.getState().sessions["s1"]?.thinkingLevel).toBe("high");
  });

  it("hydrate without a thinking level leaves it undefined", () => {
    useSessionStore.getState().hydrate(hydrated());
    expect(useSessionStore.getState().sessions["s1"]?.thinkingLevel).toBeUndefined();
  });

  it("setThinkingLevel updates the session's level in place", () => {
    useSessionStore.getState().hydrate(hydrated());
    useSessionStore.getState().setThinkingLevel("s1", "off");
    expect(useSessionStore.getState().sessions["s1"]?.thinkingLevel).toBe("off");
  });

  it("setThinkingLevelByAgentId resolves the owning session and updates its level", () => {
    useSessionStore.getState().hydrate(hydrated({ id: "s1", agentId: "a1" }));
    useSessionStore.getState().hydrate(hydrated({ id: "s2", agentId: "a2" }));
    useSessionStore.getState().setThinkingLevelByAgentId("a2", "medium");
    expect(useSessionStore.getState().sessions["s1"]?.thinkingLevel).toBeUndefined();
    expect(useSessionStore.getState().sessions["s2"]?.thinkingLevel).toBe("medium");
  });

  it("setThinkingLevel on an unknown sessionId is a no-op", () => {
    useSessionStore.getState().setThinkingLevel("nope", "high");
    expect(useSessionStore.getState().sessions["nope"]).toBeUndefined();
  });
});

describe("session store — setTimeline (sprint-072/task-001, fork resync)", () => {
  it("replaces the timeline wholesale and recomputes userMessageCount", () => {
    useSessionStore.getState().hydrate(hydrated({ userMessageCount: 5 }));
    const fresh = timelineWith(2);
    useSessionStore.getState().setTimeline("s1", fresh);
    expect(useSessionStore.getState().sessions["s1"]?.timeline).toBe(fresh);
    expect(useSessionStore.getState().sessions["s1"]?.userMessageCount).toBe(2);
  });

  it("drops optimistic rows as a side effect of the full replace", () => {
    useSessionStore.getState().hydrate(hydrated());
    useSessionStore.getState().addOptimisticUserMessage("s1", "cm-1", "still pending");
    expect(useSessionStore.getState().sessions["s1"]?.timeline.rows.length).toBe(1);
    useSessionStore.getState().setTimeline("s1", EMPTY_TIMELINE);
    expect(useSessionStore.getState().sessions["s1"]?.timeline.rows.length).toBe(0);
  });

  it("setTimeline on an unknown sessionId is a no-op", () => {
    useSessionStore.getState().setTimeline("nope", timelineWith(1));
    expect(useSessionStore.getState().sessions["nope"]).toBeUndefined();
  });

  it("setTimelineByAgentId resolves the owning session and replaces its timeline", () => {
    useSessionStore.getState().hydrate(hydrated({ id: "s1", agentId: "a1" }));
    useSessionStore.getState().hydrate(hydrated({ id: "s2", agentId: "a2" }));
    const fresh = timelineWith(3);
    useSessionStore.getState().setTimelineByAgentId("a2", fresh);
    expect(useSessionStore.getState().sessions["s1"]?.timeline).toBe(EMPTY_TIMELINE);
    expect(useSessionStore.getState().sessions["s2"]?.timeline).toBe(fresh);
    expect(useSessionStore.getState().sessions["s2"]?.userMessageCount).toBe(3);
  });

  it("setTimelineByAgentId on an unknown agentId is a no-op", () => {
    useSessionStore.getState().hydrate(hydrated());
    useSessionStore.getState().setTimelineByAgentId("no-such-agent", timelineWith(1));
    expect(useSessionStore.getState().sessions["s1"]?.timeline).toBe(EMPTY_TIMELINE);
  });
});
