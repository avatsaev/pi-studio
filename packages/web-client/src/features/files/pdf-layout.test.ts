import { describe, expect, it } from "vitest";
import {
  MAX_SCALE,
  MIN_SCALE,
  canvasPixelRatio,
  fitWidthScale,
  nextZoom,
  pageAtMidpoint,
  pageTops,
  prevZoom,
} from "./pdf-layout.js";

describe("zoom ladder", () => {
  it("steps from an off-ladder scale to the adjacent rungs", () => {
    expect(nextZoom(0.87)).toBe(1);
    expect(prevZoom(0.87)).toBe(0.75);
  });

  it("steps past a rung it is sitting on (including float noise just below it)", () => {
    expect(nextZoom(1)).toBe(1.25);
    expect(nextZoom(0.9999999)).toBe(1.25);
    expect(prevZoom(1)).toBe(0.75);
  });

  it("stops at both ends instead of going off the ladder", () => {
    expect(nextZoom(MAX_SCALE)).toBe(MAX_SCALE);
    expect(prevZoom(MIN_SCALE)).toBe(MIN_SCALE);
    expect(nextZoom(100)).toBe(MAX_SCALE);
    expect(prevZoom(0.01)).toBe(MIN_SCALE);
  });
});

describe("fitWidthScale", () => {
  it("fills the available width with the widest page", () => {
    expect(fitWidthScale(832, 32, 400)).toBe(2);
  });

  it("clamps to the ladder range", () => {
    expect(fitWidthScale(10_000, 0, 100)).toBe(MAX_SCALE);
    expect(fitWidthScale(60, 0, 1000)).toBe(MIN_SCALE);
  });

  it("falls back to 100% for a container or page with no usable width", () => {
    expect(fitWidthScale(0, 0, 600)).toBe(1);
    expect(fitWidthScale(20, 32, 600)).toBe(1);
    expect(fitWidthScale(800, 0, 0)).toBe(1);
  });
});

describe("canvasPixelRatio", () => {
  it("uses the device pixel ratio when the canvas fits the cap", () => {
    expect(canvasPixelRatio(612, 792, 1, 2)).toBe(2);
  });

  it("shrinks the ratio so the backing store stays within the cap", () => {
    const ratio = canvasPixelRatio(612, 792, 4, 2);
    expect(ratio).toBeLessThan(2);
    const pixels = 612 * 4 * ratio * (792 * 4 * ratio);
    expect(pixels).toBeLessThanOrEqual(16_777_216 + 1);
  });
});

describe("pageTops / pageAtMidpoint", () => {
  // Three pages of 100/200/100 at scale 1, 10px gap, 20px top padding → tops 20, 130, 340.
  const tops = pageTops([100, 200, 100], 1, 10, 20);

  it("stacks pages with the gap and leading padding, scaled", () => {
    expect(tops).toEqual([20, 130, 340]);
    expect(pageTops([100, 200], 2, 10, 20)).toEqual([20, 230]);
  });

  it("reports the page under the viewport midpoint", () => {
    // viewport 200px tall: midpoint = scrollTop + 100
    expect(pageAtMidpoint(tops, 0, 200)).toBe(0);
    expect(pageAtMidpoint(tops, 40, 200)).toBe(1); // midpoint 140 ≥ 130
    expect(pageAtMidpoint(tops, 300, 200)).toBe(2);
  });

  it("clamps to the first and last page, and tolerates an empty document", () => {
    expect(pageAtMidpoint(tops, -50, 20)).toBe(0);
    expect(pageAtMidpoint(tops, 99_999, 200)).toBe(2);
    expect(pageAtMidpoint([], 0, 200)).toBe(0);
  });
});
