import { describe, it, expect } from "vitest";
import {
  resolveAgentDetailGate,
  resolveAgentDetailActions,
  enabledAgentDetailActions,
  agentDetailActionLabel,
  agentStatusBadgeVariant,
  agentStatusLabel,
} from "./agent-detail.js";

describe("resolveAgentDetailGate", () => {
  it("is ready when the agent exists (regardless of loading)", () => {
    expect(resolveAgentDetailGate({ exists: true, loading: false })).toBe("ready");
    expect(resolveAgentDetailGate({ exists: true, loading: true })).toBe("ready");
  });

  it("is loading while the directory hydrates and the agent is absent", () => {
    expect(resolveAgentDetailGate({ exists: false, loading: true })).toBe("loading");
  });

  it("is not-found once hydration settles without the agent", () => {
    expect(resolveAgentDetailGate({ exists: false, loading: false })).toBe("not-found");
  });
});

describe("resolveAgentDetailActions", () => {
  it("enables interrupt only while running", () => {
    expect(resolveAgentDetailActions("running").interrupt).toBe(true);
    expect(resolveAgentDetailActions("idle").interrupt).toBe(false);
    expect(resolveAgentDetailActions(undefined).interrupt).toBe(false);
  });

  it("enables resume when stopped/idle/errored/closed but not while running", () => {
    expect(resolveAgentDetailActions("idle").resume).toBe(true);
    expect(resolveAgentDetailActions("error").resume).toBe(true);
    expect(resolveAgentDetailActions("closed").resume).toBe(true);
    expect(resolveAgentDetailActions("running").resume).toBe(false);
    expect(resolveAgentDetailActions("initializing").resume).toBe(false);
  });

  it("always allows open-in-workspace and archive for an existing agent", () => {
    for (const s of ["initializing", "idle", "running", "error", "closed"] as const) {
      const map = resolveAgentDetailActions(s);
      expect(map["open-in-workspace"]).toBe(true);
      expect(map.archive).toBe(true);
    }
  });
});

describe("enabledAgentDetailActions", () => {
  it("returns actions in a stable order, filtered to enabled", () => {
    expect(enabledAgentDetailActions("running")).toEqual(["open-in-workspace", "interrupt", "archive"]);
    expect(enabledAgentDetailActions("idle")).toEqual(["open-in-workspace", "resume", "archive"]);
    expect(enabledAgentDetailActions(undefined)).toEqual(["open-in-workspace", "archive"]);
  });
});

describe("agentStatusBadgeVariant", () => {
  it("maps statuses to badge variants", () => {
    expect(agentStatusBadgeVariant("running")).toBe("success");
    expect(agentStatusBadgeVariant("idle")).toBe("success");
    expect(agentStatusBadgeVariant("error")).toBe("error");
    expect(agentStatusBadgeVariant("closed")).toBe("muted");
    expect(agentStatusBadgeVariant("initializing")).toBe("muted");
    expect(agentStatusBadgeVariant(undefined)).toBe("muted");
  });
});

describe("agentStatusLabel", () => {
  it("labels every status", () => {
    expect(agentStatusLabel("running")).toBe("Running");
    expect(agentStatusLabel("idle")).toBe("Idle");
    expect(agentStatusLabel(undefined)).toBe("Unknown");
  });
});

describe("agentDetailActionLabel", () => {
  it("labels every action", () => {
    expect(agentDetailActionLabel("open-in-workspace")).toBe("Open in workspace");
    expect(agentDetailActionLabel("interrupt")).toBe("Interrupt");
    expect(agentDetailActionLabel("resume")).toBe("Resume");
    expect(agentDetailActionLabel("archive")).toBe("Archive");
  });
});
