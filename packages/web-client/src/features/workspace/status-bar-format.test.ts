import { describe, expect, it } from "vitest";
import {
  formatBranchMeta,
  formatCost,
  formatCwd,
  formatPercent,
  formatTokens,
} from "./status-bar-format.js";

describe("formatTokens", () => {
  it("undefined -> placeholder", () => {
    expect(formatTokens(undefined)).toBe("--");
  });

  it("below 1000 is exact", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("at the 1000 boundary switches to k-notation with one decimal", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(16_432)).toBe("16.4k");
  });

  it("at the 1_000_000 boundary switches to M-notation with one decimal", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(1_234_000)).toBe("1.2M");
  });
});

describe("formatPercent", () => {
  it("undefined/null -> placeholder", () => {
    expect(formatPercent(undefined)).toBe("--");
    expect(formatPercent(null)).toBe("--");
  });

  it("normalizes a 0-1 fraction to a rounded whole-number percent", () => {
    expect(formatPercent(0.25)).toBe("25%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("passes a 0-100 whole number through unchanged (rounded)", () => {
    expect(formatPercent(42)).toBe("42%");
    expect(formatPercent(42.6)).toBe("43%");
  });
});

describe("formatCost", () => {
  it("undefined -> placeholder", () => {
    expect(formatCost(undefined)).toBe("--");
  });

  it("sub-dollar costs keep 4 decimal places", () => {
    expect(formatCost(0.0421)).toBe("$0.0421");
    expect(formatCost(0)).toBe("$0.0000");
  });

  it("dollar-or-more costs use 2 decimal places", () => {
    expect(formatCost(1)).toBe("$1.00");
    expect(formatCost(12.345)).toBe("$12.35");
  });
});

describe("formatCwd", () => {
  it("collapses an exact home match to ~", () => {
    expect(formatCwd("/home/dev", "/home/dev")).toBe("~");
  });

  it("collapses a home-prefixed path to ~/...", () => {
    expect(formatCwd("/home/dev/project", "/home/dev")).toBe("~/project");
  });

  it("is a no-op when home is null/undefined", () => {
    expect(formatCwd("/home/dev/project", null)).toBe("/home/dev/project");
    expect(formatCwd("/home/dev/project", undefined)).toBe("/home/dev/project");
  });

  it("is a no-op when home is not a prefix of cwd", () => {
    expect(formatCwd("/var/lib/project", "/home/dev")).toBe("/var/lib/project");
  });

  it("does not false-positive on a sibling directory sharing a prefix (e.g. /home/dev vs /home/devops)", () => {
    expect(formatCwd("/home/devops/project", "/home/dev")).toBe("/home/devops/project");
  });
});

describe("formatBranchMeta", () => {
  it("both zero -> empty string", () => {
    expect(formatBranchMeta(0, 0)).toBe("");
  });

  it("only ahead", () => {
    expect(formatBranchMeta(2, 0)).toBe("↑2");
  });

  it("only behind", () => {
    expect(formatBranchMeta(0, 1)).toBe("↓1");
  });

  it("both ahead and behind", () => {
    expect(formatBranchMeta(2, 1)).toBe("↑2 ↓1");
  });
});
