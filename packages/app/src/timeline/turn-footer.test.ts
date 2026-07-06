import { describe, it, expect } from "vitest";
import { formatTurnFooterWithUsage, type TurnFooter } from "./turn-grouping.js";

const completed: TurnFooter = { turnId: "t1", status: "completed", durationMs: 3000 };
const running: TurnFooter = { turnId: "t2", status: "running" };

describe("formatTurnFooterWithUsage", () => {
  it("appends a token count to a completed footer", () => {
    expect(formatTurnFooterWithUsage(completed, 1234)).toBe("Worked for 3s · 1.2k tokens");
    expect(formatTurnFooterWithUsage(completed, 900)).toBe("Worked for 3s · 900 tokens");
  });

  it("omits the token count when absent or zero", () => {
    expect(formatTurnFooterWithUsage(completed)).toBe("Worked for 3s");
    expect(formatTurnFooterWithUsage(completed, 0)).toBe("Worked for 3s");
  });

  it("never appends tokens to a running footer", () => {
    expect(formatTurnFooterWithUsage(running, 5000)).toBe("Working…");
  });
});
