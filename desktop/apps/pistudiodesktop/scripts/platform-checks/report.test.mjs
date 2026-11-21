import { describe, expect, it } from "vitest";

import { formatDuration, Report, renderSummary, Skip } from "./report.mjs";

describe("Report", () => {
  it("records a pass, a failure and a skip, and says whether anything failed", async () => {
    const report = new Report();
    await report.run("a", "passes", async ({ note }) => note("fine"));
    expect(report.failed).toBe(false);
    await report.run("b", "fails", async () => {
      throw new Error("broken");
    });
    await report.run("c", "skips", async () => {
      throw new Skip("not here");
    });
    expect(report.results.map((r) => [r.id, r.status, r.error])).toEqual([
      ["a", "pass", undefined],
      ["b", "fail", "broken"],
      ["c", "skip", "not here"],
    ]);
    expect(report.results[0].notes).toEqual(["fine"]);
    expect(report.failed).toBe(true);
  });

  it("returns whether the check passed", async () => {
    const report = new Report();
    expect(await report.run("a", "ok", async () => {})).toBe(true);
    expect(await report.run("b", "bad", async () => Promise.reject(new Error("x")))).toBe(false);
  });

  it("skips a list of checks with the reason", () => {
    const report = new Report();
    report.skipAll([{ id: "x", title: "X" }], "earlier failed");
    expect(report.results).toMatchObject([{ id: "x", status: "skip", error: "earlier failed" }]);
    expect(report.failed).toBe(false);
  });
});

describe("renderSummary", () => {
  it("renders a table and the printed facts, with pipes and backticks made safe", async () => {
    const report = new Report();
    await report.run("a.b", "first | check", async ({ note }) => note("took 1 s"));
    await report.run("c", "second", async () => {
      throw new Error("line one\nline two");
    });
    report.fact("Config dir", "C:\\Users\\x\\`dir`");
    const text = renderSummary("Heading", report);
    expect(text).toContain("## Heading");
    expect(text).toContain("1 passed, 1 failed, 0 skipped.");
    expect(text).toContain("| PASS | `a.b` first \\| check |");
    expect(text).toContain("| FAIL | `c` second |");
    expect(text).toContain("line one line two");
    expect(text).toContain("### Printed, not asserted");
    expect(text).toContain("- **Config dir**");
    expect(text).toContain("`C:\\Users\\x\\'dir'`");
  });

  it("has no facts section without facts", () => {
    expect(renderSummary("H", new Report())).not.toContain("Printed");
  });
});

describe("formatDuration", () => {
  it("uses milliseconds under a second and seconds above", () => {
    expect(formatDuration(840)).toBe("840 ms");
    expect(formatDuration(12_340)).toBe("12.3 s");
  });
});
