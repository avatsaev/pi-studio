import { describe, it, expect } from "vitest";
import { buildThinkingCard, thinkingLabel, formatElapsed } from "./thinking.js";

describe("buildThinkingCard", () => {
  it("is active + shimmering while reasoning and no response yet", () => {
    const m = buildThinkingCard({ text: "hmm", active: true, startedAt: 1000, now: 4000, responseStarted: false });
    expect(m.status).toBe("active");
    expect(m.shimmer).toBe(true);
    expect(m.collapsed).toBe(false);
    expect(m.elapsedMs).toBe(3000);
    expect(thinkingLabel(m)).toBe("Thinking…");
  });

  it("auto-collapses and becomes done when the response starts", () => {
    const m = buildThinkingCard({ text: "hmm", active: true, startedAt: 1000, now: 4000, responseStarted: true });
    expect(m.status).toBe("done");
    expect(m.shimmer).toBe(false);
    expect(m.collapsed).toBe(true);
    expect(thinkingLabel(m)).toBe("Thought for 3s");
  });

  it("honors a manual collapse override", () => {
    const expanded = buildThinkingCard({ text: "x", active: true, startedAt: 0, now: 100, responseStarted: true, manualCollapsed: false });
    expect(expanded.collapsed).toBe(false);
  });
});

describe("formatElapsed", () => {
  it("formats sub-second, seconds, minutes", () => {
    expect(formatElapsed(500)).toBe("<1s");
    expect(formatElapsed(3000)).toBe("3s");
    expect(formatElapsed(65000)).toBe("1m 5s");
    expect(formatElapsed(120000)).toBe("2m");
  });
});
