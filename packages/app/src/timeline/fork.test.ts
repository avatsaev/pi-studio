import { describe, it, expect } from "vitest";
import { buildForkRequest, canFork } from "./fork.js";

describe("buildForkRequest", () => {
  it("includes a forkFrom marker and omits undefined fields", () => {
    expect(buildForkRequest({ sourceAgentId: "a1", messageId: "m5" })).toEqual({
      forkFrom: { agentId: "a1", messageId: "m5" },
    });
  });

  it("carries provider and cwd when provided", () => {
    expect(buildForkRequest({ sourceAgentId: "a1", messageId: "m5", provider: "pi", cwd: "/w" })).toEqual({
      forkFrom: { agentId: "a1", messageId: "m5" },
      provider: "pi",
      cwd: "/w",
    });
  });
});

describe("canFork", () => {
  it("offers fork only on assistant messages", () => {
    expect(canFork("assistant_message")).toBe(true);
    expect(canFork("user_message")).toBe(false);
    expect(canFork("tool_call")).toBe(false);
  });
});
