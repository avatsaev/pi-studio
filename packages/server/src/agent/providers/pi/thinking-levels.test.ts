/**
 * Unit tests for the pi-ai `getSupportedThinkingLevels` mirror (sprint-070/task-001). The
 * derivation table mirrors the verified Pi source (`models.js:547-559`), plus the
 * absent/malformed-input tolerance the untyped-Record layer requires.
 */

import { describe, expect, it } from "vitest";

import { deriveThinkingLevels } from "./thinking-levels.js";

const BASE_FIVE = ["off", "minimal", "low", "medium", "high"];

describe("deriveThinkingLevels", () => {
  it('non-reasoning model → ["off"]', () => {
    expect(deriveThinkingLevels({ id: "m", reasoning: false })).toEqual(["off"]);
  });

  it('absent reasoning (malformed/unknown model) → ["off"]', () => {
    expect(deriveThinkingLevels({ id: "m" })).toEqual(["off"]);
    expect(deriveThinkingLevels(undefined)).toEqual(["off"]);
    expect(deriveThinkingLevels("not-an-object")).toEqual(["off"]);
  });

  it("reasoning model with no thinkingLevelMap → base five (xhigh/max opt-in, absent ⇒ excluded)", () => {
    expect(deriveThinkingLevels({ id: "m", reasoning: true })).toEqual(BASE_FIVE);
  });

  it("malformed thinkingLevelMap (not an object) → base five", () => {
    expect(deriveThinkingLevels({ id: "m", reasoning: true, thinkingLevelMap: "nope" })).toEqual(
      BASE_FIVE,
    );
  });

  it("a null map entry removes the level", () => {
    expect(
      deriveThinkingLevels({ id: "m", reasoning: true, thinkingLevelMap: { high: null } }),
    ).toEqual(["off", "minimal", "low", "medium"]);
  });

  it("xhigh/max require a non-null map entry to appear", () => {
    expect(
      deriveThinkingLevels({
        id: "m",
        reasoning: true,
        thinkingLevelMap: { xhigh: "supported", max: null },
      }),
    ).toEqual([...BASE_FIVE, "xhigh"]);
    expect(
      deriveThinkingLevels({
        id: "m",
        reasoning: true,
        thinkingLevelMap: { xhigh: "supported", max: "supported" },
      }),
    ).toEqual([...BASE_FIVE, "xhigh", "max"]);
  });
});
