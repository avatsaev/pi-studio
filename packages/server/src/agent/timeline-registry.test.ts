import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";

import { TimelineRegistry } from "./timeline-registry.js";
import type { TimelineRow } from "./timeline-store.js";

const NOW = "2026-06-11T12:00:00.000Z";

function row(seq: number, epoch = 1): TimelineRow {
  return {
    epoch,
    seq,
    seqEnd: seq,
    timestamp: NOW,
    event: { kind: "turn_started" } as AgentStreamEvent,
  };
}

describe("TimelineRegistry.reset (fork resync)", () => {
  it("replaces rows on an agent that already has a populated in-memory store, unlike seed", () => {
    const timelines = new TimelineRegistry();
    const agentId = "reset-populated";
    timelines.seed(agentId, [row(0), row(1)]);
    expect(timelines.get(agentId)?.rowCount()).toBe(2);

    // seed is a no-op once a store exists — demonstrating the contrast reset exists to fix.
    timelines.seed(agentId, [row(0), row(1), row(2)]);
    expect(timelines.get(agentId)?.rowCount()).toBe(2);

    // reset unconditionally replaces it.
    timelines.reset(agentId, [row(9)]);
    expect(timelines.get(agentId)?.rowCount()).toBe(1);
    expect(timelines.get(agentId)?.allRows()).toEqual([row(9)]);
  });

  it("empties the store without throwing when given an empty rows array", () => {
    const timelines = new TimelineRegistry();
    timelines.seed("reset-empty", [row(0)]);
    expect(() => timelines.reset("reset-empty", [])).not.toThrow();
    expect(timelines.get("reset-empty")?.rowCount()).toBe(0);
  });

  it("creates a store if none exists yet", () => {
    const timelines = new TimelineRegistry();
    expect(timelines.get("reset-fresh")).toBeUndefined();
    timelines.reset("reset-fresh", [row(0)]);
    expect(timelines.get("reset-fresh")?.rowCount()).toBe(1);
  });

  it("next epoch/seq numbering continues from the installed rows' maximum", () => {
    const timelines = new TimelineRegistry();
    timelines.reset("reset-continuation", [row(0, 2), row(1, 2)]);
    const timeline = timelines.get("reset-continuation");
    timeline?.startEpoch();
    const appended = timeline?.append({ kind: "turn_completed" } as AgentStreamEvent);
    expect(appended?.epoch).toBe(3);
    expect(appended?.seq).toBe(2);
  });
});

describe("TimelineRegistry.evict", () => {
  it("drops only the named agent's store", () => {
    const timelines = new TimelineRegistry();
    timelines.seed("a", [row(0)]);
    timelines.seed("b", [row(0)]);

    timelines.evict("a");

    expect(timelines.get("a")).toBeUndefined();
    expect(timelines.get("b")?.rowCount()).toBe(1);
    expect(timelines.size).toBe(1);
  });

  it("is a no-op for an agent with no store", () => {
    const timelines = new TimelineRegistry();
    expect(() => timelines.evict("never-had-one")).not.toThrow();
    expect(timelines.size).toBe(0);
  });
});
