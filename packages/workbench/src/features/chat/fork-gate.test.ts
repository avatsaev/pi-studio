import { describe, expect, it } from "vitest";
import { canOfferFork } from "./fork-gate.js";

describe("canOfferFork", () => {
  const base = { forkTimelineSync: true, running: false, agentId: "agent-1" };

  it("is true when the capability is advertised, idle, and a live process exists", () => {
    expect(canOfferFork(base)).toBe(true);
  });

  it("is false when the server doesn't advertise forkTimelineSync", () => {
    expect(canOfferFork({ ...base, forkTimelineSync: false })).toBe(false);
  });

  it("is false while a turn is running", () => {
    expect(canOfferFork({ ...base, running: true })).toBe(false);
  });

  it("is false for a process-less draft session (agentId null)", () => {
    expect(canOfferFork({ ...base, agentId: null })).toBe(false);
  });

  it("is false when every condition fails at once", () => {
    expect(canOfferFork({ forkTimelineSync: false, running: true, agentId: null })).toBe(false);
  });
});
