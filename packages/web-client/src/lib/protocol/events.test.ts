import { describe, expect, it } from "vitest";
import { flattenTimelineItems } from "./events.js";

describe("flattenTimelineItems", () => {
  it("pairs an 'other' item's event with its own timestamp", () => {
    const events = flattenTimelineItems([
      { kind: "other", event: { kind: "turn_started" }, timestamp: "2026-08-17T13:00:00.000Z" },
    ]);
    expect(events).toEqual([
      { event: { kind: "turn_started" }, timestamp: "2026-08-17T13:00:00.000Z" },
    ]);
  });

  it("stamps only the first event of a merged assistant/reasoning group", () => {
    const events = flattenTimelineItems([
      {
        kind: "assistant",
        timestamp: "2026-08-17T13:00:00.000Z",
        events: [
          { kind: "assistant_message", text: "a" },
          { kind: "reasoning", text: "b" },
          { kind: "assistant_message", text: "c" },
        ],
      },
    ]);
    expect(events).toEqual([
      { event: { kind: "assistant_message", text: "a" }, timestamp: "2026-08-17T13:00:00.000Z" },
      { event: { kind: "reasoning", text: "b" }, timestamp: undefined },
      { event: { kind: "assistant_message", text: "c" }, timestamp: undefined },
    ]);
  });

  it("stamps only the first event of a collapsed tool_call group", () => {
    const events = flattenTimelineItems([
      {
        kind: "tool_call",
        timestamp: "2026-08-17T13:00:00.000Z",
        events: [
          { kind: "tool_call", tool: { kind: "shell" }, status: "running" },
          { kind: "tool_call", tool: { kind: "shell" }, status: "completed" },
        ],
      },
    ]);
    expect(events.map((e) => e.timestamp)).toEqual(["2026-08-17T13:00:00.000Z", undefined]);
  });

  it("ignores items missing the expected shape without throwing", () => {
    expect(flattenTimelineItems([null, "garbage", { no: "kind" }, { kind: "other" }])).toEqual([]);
  });
});
