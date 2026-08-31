import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";

import { getTimeline, resetTimeline, seedTimeline } from "./agent-service.js";
import type { TimelineRow } from "./timeline-store.js";

const NOW = "2026-06-11T12:00:00.000Z";

function row(seq: number, epoch = 1): TimelineRow {
  return { epoch, seq, timestamp: NOW, event: { kind: "turn_started" } as AgentStreamEvent };
}

describe("resetTimeline (fork resync)", () => {
  it("replaces rows on an agent that already has a populated in-memory store, unlike seedTimeline", () => {
    const agentId = `reset-populated-${Math.random()}`;
    seedTimeline(agentId, [row(0), row(1)]);
    expect(getTimeline(agentId)?.rowCount()).toBe(2);

    // seedTimeline is a no-op once a store exists — demonstrating the contrast this task exists to fix.
    seedTimeline(agentId, [row(0), row(1), row(2)]);
    expect(getTimeline(agentId)?.rowCount()).toBe(2);

    // resetTimeline unconditionally replaces it.
    resetTimeline(agentId, [row(9)]);
    expect(getTimeline(agentId)?.rowCount()).toBe(1);
    expect(getTimeline(agentId)?.allRows()).toEqual([row(9)]);
  });

  it("empties the store without throwing when given an empty rows array", () => {
    const agentId = `reset-empty-${Math.random()}`;
    seedTimeline(agentId, [row(0)]);
    expect(() => resetTimeline(agentId, [])).not.toThrow();
    expect(getTimeline(agentId)?.rowCount()).toBe(0);
  });

  it("creates a store if none exists yet", () => {
    const agentId = `reset-fresh-${Math.random()}`;
    expect(getTimeline(agentId)).toBeUndefined();
    resetTimeline(agentId, [row(0)]);
    expect(getTimeline(agentId)?.rowCount()).toBe(1);
  });

  it("next epoch/seq numbering continues from the installed rows' maximum", () => {
    const agentId = `reset-continuation-${Math.random()}`;
    resetTimeline(agentId, [row(0, 2), row(1, 2)]);
    const timeline = getTimeline(agentId);
    timeline?.startEpoch();
    const appended = timeline?.append({ kind: "turn_completed" } as AgentStreamEvent);
    expect(appended?.epoch).toBe(3);
    expect(appended?.seq).toBe(2);
  });
});
