import { describe, it, expect } from "vitest";
import { summarizeActivity, type ActivityEvent } from "./activity-pills.js";

describe("summarizeActivity", () => {
  it("groups file events into one 'N files edited' pill", () => {
    const events: ActivityEvent[] = [
      { kind: "file", message: "edited a.ts", metadata: { path: "a.ts" } },
      { kind: "file", message: "edited b.ts", metadata: { path: "b.ts" } },
      { kind: "file", message: "edited c.ts", metadata: { path: "c.ts" } },
    ];
    const pills = summarizeActivity(events);
    expect(pills).toHaveLength(1);
    expect(pills[0]!.label).toBe("3 files edited");
    expect(pills[0]!.items).toHaveLength(3);
  });

  it("links a single file pill to its file target", () => {
    const pills = summarizeActivity([{ kind: "file", message: "e", metadata: { path: "x.ts" } }]);
    expect(pills[0]!.label).toBe("1 file edited");
    expect(pills[0]!.linkTarget).toEqual({ type: "file", value: "x.ts" });
  });

  it("summarizes a git commit with a short sha", () => {
    const pills = summarizeActivity([{ kind: "git", message: "commit", metadata: { sha: "abc1234567" } }]);
    expect(pills[0]!.label).toBe("committed abc1234");
    expect(pills[0]!.tone).toBe("success");
  });

  it("summarizes a terminal command and links to its tab", () => {
    const pills = summarizeActivity([
      { kind: "terminal", message: "run", metadata: { command: "npm test", terminalTabId: "t1" } },
    ]);
    expect(pills[0]!.label).toBe("ran npm test");
    expect(pills[0]!.linkTarget).toEqual({ type: "terminal", value: "t1" });
  });

  it("keeps generic pills with the right tone and preserves order + file group last", () => {
    const pills = summarizeActivity([
      { kind: "error", message: "boom" },
      { kind: "file", message: "e", metadata: { path: "a" } },
      { kind: "success", message: "ok" },
    ]);
    expect(pills.map((p) => p.kind)).toEqual(["error", "success", "file"]);
    expect(pills[0]!.tone).toBe("error");
  });
});
