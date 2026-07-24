import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore, type SessionEntry } from "./session-store.js";
import { EMPTY_TIMELINE } from "@pi-studio-ui/timeline/reducer.js";

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
