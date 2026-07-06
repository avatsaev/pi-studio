import { describe, it, expect } from "vitest";
import { buildCompactionMarker, buildLoadFullHistoryRequest } from "./compaction.js";

describe("buildCompactionMarker", () => {
  it("shows a compacting spinner label while loading and hides load-full", () => {
    const m = buildCompactionMarker({ status: "loading" });
    expect(m.label).toBe("Compacting…");
    expect(m.canLoadFull).toBe(false);
  });

  it("labels a completed marker with the summarized turn count", () => {
    const m = buildCompactionMarker({ status: "completed", summarizedTurns: 12 });
    expect(m.label).toBe("Conversation compacted — 12 turns summarized");
    expect(m.canLoadFull).toBe(true);
  });

  it("falls back to token count then to trigger wording", () => {
    expect(buildCompactionMarker({ status: "completed", preTokens: 8000 }).label).toBe("Context compacted (8000 tokens)");
    expect(buildCompactionMarker({ status: "completed", trigger: "manual" }).label).toBe("Context manually compacted");
    expect(buildCompactionMarker({ status: "completed" }).label).toBe("Context automatically compacted");
  });

  it("carries the summary text through", () => {
    expect(buildCompactionMarker({ status: "completed", summary: "s" }).summary).toBe("s");
  });
});

describe("buildLoadFullHistoryRequest", () => {
  it("builds a before-direction pagination request", () => {
    expect(buildLoadFullHistoryRequest("a1", "cur")).toEqual({ agentId: "a1", cursor: "cur", direction: "before" });
  });
});
