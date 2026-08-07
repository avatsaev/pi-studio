import { describe, expect, it } from "vitest";
import { isMeasurable, sameGrid, shouldClaimSize, type Grid } from "./terminal-size.js";

const g = (cols: number, rows: number): Grid => ({ cols, rows });

describe("isMeasurable", () => {
  it("rejects undefined and null", () => {
    expect(isMeasurable(undefined)).toBe(false);
    expect(isMeasurable(null)).toBe(false);
  });

  it("rejects NaN on either axis", () => {
    expect(isMeasurable({ cols: Number.NaN, rows: 24 })).toBe(false);
    expect(isMeasurable({ cols: 80, rows: Number.NaN })).toBe(false);
  });

  it("rejects zero on either axis", () => {
    expect(isMeasurable({ cols: 0, rows: 24 })).toBe(false);
    expect(isMeasurable({ cols: 80, rows: 0 })).toBe(false);
  });

  it("rejects negative values", () => {
    expect(isMeasurable({ cols: -80, rows: 24 })).toBe(false);
    expect(isMeasurable({ cols: 80, rows: -24 })).toBe(false);
  });

  it("rejects fractional values", () => {
    expect(isMeasurable({ cols: 80.5, rows: 24 })).toBe(false);
    expect(isMeasurable({ cols: 80, rows: 24.5 })).toBe(false);
  });

  it("rejects below-minimum values (cols < 2, rows < 1)", () => {
    expect(isMeasurable({ cols: 1, rows: 24 })).toBe(false);
    expect(isMeasurable({ cols: 80, rows: 0 })).toBe(false);
  });

  it("accepts the emulator minimum boundary (cols=2, rows=1)", () => {
    expect(isMeasurable({ cols: 2, rows: 1 })).toBe(true);
  });

  it("accepts a valid grid", () => {
    expect(isMeasurable({ cols: 80, rows: 24 })).toBe(true);
  });
});

describe("sameGrid", () => {
  it("treats two nulls as equal", () => {
    expect(sameGrid(null, null)).toBe(true);
  });

  it("treats one null as unequal", () => {
    expect(sameGrid(g(80, 24), null)).toBe(false);
    expect(sameGrid(null, g(80, 24))).toBe(false);
  });

  it("treats identical grids as equal", () => {
    expect(sameGrid(g(80, 24), g(80, 24))).toBe(true);
  });

  it("treats a differing cols axis as unequal", () => {
    expect(sameGrid(g(80, 24), g(81, 24))).toBe(false);
  });

  it("treats a differing rows axis as unequal", () => {
    expect(sameGrid(g(80, 24), g(80, 25))).toBe(false);
  });
});

describe("shouldClaimSize (pure validity + dedupe; permission is the caller's gate)", () => {
  it("is false for an unmeasurable proposal, whatever is believed", () => {
    expect(shouldClaimSize(null, g(80, 24))).toBe(false);
    expect(shouldClaimSize({ cols: 0, rows: 24 } as Grid, g(80, 24))).toBe(false);
    expect(shouldClaimSize(null, null)).toBe(false);
  });

  it("is false when the proposal matches the believed size (dedupe)", () => {
    expect(shouldClaimSize(g(80, 24), g(80, 24))).toBe(false);
  });

  it("is true when the proposal differs from the believed size", () => {
    expect(shouldClaimSize(g(140, 40), g(80, 24))).toBe(true);
  });

  it("is true when nothing is believed yet — the restored-terminal case", () => {
    // A restored terminal's PTY predates this client, so it has never sent a size. The old
    // `shouldClaimOnChange` returned false here, which is what made a restored terminal ignore
    // every divider drag and window resize for its whole life.
    expect(shouldClaimSize(g(140, 40), null)).toBe(true);
  });

  it("distinguishes a differing rows axis alone", () => {
    expect(shouldClaimSize(g(80, 25), g(80, 24))).toBe(true);
  });
});
