import { describe, expect, it } from "vitest";
import { hasStringModel, hasStringThinkingLevel, hasStringTitle } from "./use-session-restore.js";
import type { AgentUpdateMessage } from "@av-pi-studio/client";

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
