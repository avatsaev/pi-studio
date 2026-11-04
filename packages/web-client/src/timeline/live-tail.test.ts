import { describe, expect, it } from "vitest";
import { LIVE_TAIL_LINES, liveTail } from "./live-tail.js";

function numbered(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");
}

describe("liveTail", () => {
  it("returns the whole text when shorter than the cap", () => {
    expect(liveTail("a\nb")).toBe("a\nb");
  });

  it("returns only the last 12 lines for longer output", () => {
    const tail = liveTail(numbered(30));
    const lines = tail.split("\n");
    expect(LIVE_TAIL_LINES).toBe(12);
    expect(lines).toHaveLength(12);
    expect(lines[0]).toBe("line 19");
    expect(lines[11]).toBe("line 30");
  });

  it("does not yield a blank last line for a trailing newline", () => {
    expect(liveTail("a\nb\n")).toBe("a\nb");
    const lines = liveTail(`${numbered(20)}\n`).split("\n");
    expect(lines).toHaveLength(12);
    expect(lines[11]).toBe("line 20");
  });

  it("is deterministic", () => {
    const text = numbered(25);
    expect(liveTail(text)).toBe(liveTail(text));
  });
});
