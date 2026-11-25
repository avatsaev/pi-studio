import { beforeEach, describe, expect, it } from "vitest";
import type { AgentUpdateMessage } from "@av-pi-studio/client";
import { useSessionStore } from "../stores/session-store.js";
import { EMPTY_TIMELINE } from "../timeline/reducer.js";
import {
  applyAgentUpdate,
  hasStringModel,
  hasStringThinkingLevel,
  hasStringTitle,
} from "./use-session-restore.js";

function agentUpdate(overrides: Partial<AgentUpdateMessage> = {}): AgentUpdateMessage {
  return { type: "agent_update", agentId: "a1", ...overrides };
}

describe("hasStringModel (sprint-042 — agent_update model listener)", () => {
  it("is true when model is a string", () => {
    expect(hasStringModel(agentUpdate({ model: "opus" }))).toBe(true);
  });

  it("is true for an empty string (still a string)", () => {
    expect(hasStringModel(agentUpdate({ model: "" }))).toBe(true);
  });

  it("is false when model is absent", () => {
    expect(hasStringModel(agentUpdate())).toBe(false);
  });

  it("is false when model is present but not a string (e.g. a cycle-response's structured value)", () => {
    expect(hasStringModel(agentUpdate({ model: { id: "opus" } as unknown as string }))).toBe(false);
  });
});
describe("hasStringThinkingLevel (sprint-070 — agent_update thinkingLevel listener)", () => {
  it("is true when thinkingLevel is a string", () => {
    expect(hasStringThinkingLevel(agentUpdate({ thinkingLevel: "off" }))).toBe(true);
  });

  it("is false when thinkingLevel is absent", () => {
    expect(hasStringThinkingLevel(agentUpdate())).toBe(false);
  });

  it("is false when thinkingLevel is present but not a string", () => {
    expect(hasStringThinkingLevel(agentUpdate({ thinkingLevel: 5 as unknown as string }))).toBe(
      false,
    );
  });
});

describe("hasStringTitle (auto-titling — agent_update title listener)", () => {
  it("is true when title is a string", () => {
    expect(hasStringTitle(agentUpdate({ title: "Fix login bug" }))).toBe(true);
  });

  it("is true for an empty string (still a string)", () => {
    expect(hasStringTitle(agentUpdate({ title: "" }))).toBe(true);
  });

  it("is false when title is absent", () => {
    expect(hasStringTitle(agentUpdate())).toBe(false);
  });

  it("is false when title is present but not a string", () => {
    expect(hasStringTitle(agentUpdate({ title: 5 as unknown as string }))).toBe(false);
  });
});

const session = () => useSessionStore.getState().sessions["s1"];

describe("applyAgentUpdate (sprint-152 — agent_update status)", () => {
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

  it("applies running, idle and error to the session of that agent", () => {
    applyAgentUpdate(agentUpdate({ status: "running" }));
    expect(session()?.status).toBe("running");
    applyAgentUpdate(agentUpdate({ status: "idle" }));
    expect(session()?.status).toBe("idle");
    applyAgentUpdate(agentUpdate({ status: "error" }));
    expect(session()?.status).toBe("error");
  });

  it("leaves the status alone for initializing, closed and an update without one", () => {
    applyAgentUpdate(agentUpdate({ status: "running" }));
    applyAgentUpdate(agentUpdate({ status: "initializing" }));
    applyAgentUpdate(agentUpdate({ status: "closed" }));
    applyAgentUpdate(agentUpdate({ model: "opus" }));
    expect(session()?.status).toBe("running");
  });

  it("applies the status and the model of one update together", () => {
    applyAgentUpdate(agentUpdate({ status: "running", model: "opus", modelProvider: "anthropic" }));
    expect(session()).toMatchObject({
      status: "running",
      model: "opus",
      modelProvider: "anthropic",
    });
  });

  it("ignores an update for an agent no session shows", () => {
    applyAgentUpdate(agentUpdate({ agentId: "other", status: "running" }));
    expect(session()?.status).toBe("idle");
  });
});
