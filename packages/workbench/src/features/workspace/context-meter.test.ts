import { describe, expect, it } from "vitest";
import {
  meterFill,
  meterState,
  meterText,
  meterTitle,
  meterTone,
  meterValueNow,
} from "./context-meter.js";

describe("meterState", () => {
  it("compacting wins over any stats", () => {
    expect(meterState({ contextTokens: 1, contextWindow: 2 }, true)).toEqual({
      kind: "compacting",
    });
  });

  it("is unknown with no data, and with only a window (Pi's null usage after a compaction)", () => {
    expect(meterState(undefined, false)).toEqual({ kind: "unknown" });
    expect(meterState({ contextWindow: 200_000 }, false)).toEqual({ kind: "unknown" });
  });

  it("derives the fraction from tokens / window, including zero tokens", () => {
    expect(meterState({ contextTokens: 84_000, contextWindow: 200_000 }, false)).toEqual({
      kind: "value",
      fraction: 0.42,
      estimated: false,
    });
    expect(meterState({ contextTokens: 0, contextWindow: 200_000 }, false)).toMatchObject({
      fraction: 0,
    });
  });

  it("falls back to percent / 100 (Pi's 0-100 scale) when tokens or window is missing", () => {
    expect(meterState({ contextPercent: 42 }, false)).toEqual({
      kind: "value",
      fraction: 0.42,
      estimated: false,
    });
  });

  it("carries the estimated flag", () => {
    const state = meterState(
      { contextTokens: 14_000, contextWindow: 200_000, contextEstimated: true },
      false,
    );
    expect(state).toMatchObject({ kind: "value", estimated: true });
  });
});

describe("meterTone", () => {
  it("switches at exactly 0.70 and 0.90", () => {
    expect(meterTone(0.6999)).toBe("normal");
    expect(meterTone(0.7)).toBe("warning");
    expect(meterTone(0.8999)).toBe("warning");
    expect(meterTone(0.9)).toBe("danger");
    expect(meterTone(1.2)).toBe("danger");
  });
});

describe("meter presentation", () => {
  const stats = { contextTokens: 84_100, contextWindow: 200_000 };
  const est = { contextTokens: 14_200, contextWindow: 200_000, contextEstimated: true };

  it("text: percent, estimated tilde, unknown dash, compacting", () => {
    expect(meterText(meterState(stats, false))).toBe("42%");
    expect(meterText(meterState({ ...est }, false))).toBe("~7%");
    expect(meterText(meterState(undefined, false))).toBe("—");
    expect(meterText(meterState(stats, true))).toBe("Compacting…");
    expect(meterText(meterState({ contextTokens: 700, contextWindow: 200_000 }, false))).toBe(
      "<1%",
    );
  });

  it("title: absolute tokens, flagged when estimated", () => {
    expect(meterTitle(stats, meterState(stats, false))).toBe("84.1k / 200.0k tokens");
    expect(meterTitle(est, meterState(est, false))).toBe("≈ 14.2k / 200.0k tokens (estimate)");
  });

  it("fill is clamped to 0-1 and aria-valuenow omitted unless there is a value", () => {
    expect(meterFill({ kind: "value", fraction: 1.4, estimated: false })).toBe(1);
    expect(meterFill({ kind: "value", fraction: -1, estimated: false })).toBe(0);
    expect(meterFill({ kind: "unknown" })).toBe(0);
    expect(meterValueNow({ kind: "value", fraction: 0.424, estimated: false })).toBe(42);
    expect(meterValueNow({ kind: "unknown" })).toBeUndefined();
    expect(meterValueNow({ kind: "compacting" })).toBeUndefined();
  });
});
