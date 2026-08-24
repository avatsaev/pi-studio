/**
 * Unit tests for the draft-time level-source selection (sprint-070/task-005).
 */

import { describe, expect, it } from "vitest";

import { FALLBACK_THINKING_LEVELS, levelsForModel } from "./thinking-level-source.js";

const CATALOGUE = [
  { id: "claude-sonnet-5", thinkingLevels: ["off", "low", "medium", "high"] },
  { id: "gpt-plain", thinkingLevels: ["off"] },
  { id: "legacy-model" },
];

describe("levelsForModel", () => {
  it("returns the model's own derived list from the cached catalogue", () => {
    expect(levelsForModel("claude-sonnet-5", CATALOGUE)).toEqual(["off", "low", "medium", "high"]);
    expect(levelsForModel("gpt-plain", CATALOGUE)).toEqual(["off"]);
  });

  it("falls back to the full ladder when the model is absent from the catalogue", () => {
    expect(levelsForModel("unknown-model", CATALOGUE)).toEqual(FALLBACK_THINKING_LEVELS);
    expect(levelsForModel("unknown-model", undefined)).toEqual(FALLBACK_THINKING_LEVELS);
    expect(levelsForModel(undefined, CATALOGUE)).toEqual(FALLBACK_THINKING_LEVELS);
  });

  it("falls back to the full ladder when the matched model carries no derivation (old daemon) or an empty one", () => {
    expect(levelsForModel("legacy-model", CATALOGUE)).toEqual(FALLBACK_THINKING_LEVELS);
    expect(levelsForModel("gpt-plain", [{ id: "gpt-plain", thinkingLevels: [] }])).toEqual(
      FALLBACK_THINKING_LEVELS,
    );
  });
});
