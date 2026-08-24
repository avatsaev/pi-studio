import { describe, expect, it } from "vitest";
import { sortCurrentFirst, dedupeByModelKey } from "./model-menu-sort.js";

const models = [
  { id: "m1", label: "Model One" },
  { id: "m2", label: "Model Two" },
  { id: "m3", label: "Model Three" },
];

describe("sortCurrentFirst", () => {
  it("moves the current model to index 0, keeping the rest in server order", () => {
    const result = sortCurrentFirst(models, "m2");
    expect(result.map((m) => m.id)).toEqual(["m2", "m1", "m3"]);
  });

  it("is a no-op when the current model is already first", () => {
    const result = sortCurrentFirst(models, "m1");
    expect(result.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("returns the original list unchanged when currentModel is undefined", () => {
    const result = sortCurrentFirst(models, undefined);
    expect(result).toBe(models);
  });

  it("returns the original list unchanged when currentModel matches no model", () => {
    const result = sortCurrentFirst(models, "does-not-exist");
    expect(result).toBe(models);
  });

  it("returns an empty list unchanged", () => {
    expect(sortCurrentFirst([], "m1")).toEqual([]);
  });

  it("hoists the copy from currentProvider when two providers offer the same id", () => {
    const shared = [
      { id: "m1", provider: "anthropic" },
      { id: "m2", provider: "openrouter" },
      { id: "m2", provider: "anthropic" },
    ];
    const result = sortCurrentFirst(shared, "m2", "anthropic");
    expect(result).toEqual([
      { id: "m2", provider: "anthropic" },
      { id: "m1", provider: "anthropic" },
      { id: "m2", provider: "openrouter" },
    ]);
  });

  it("falls back to the first id match when currentProvider offers no such model", () => {
    const shared = [
      { id: "m1", provider: "anthropic" },
      { id: "m2", provider: "openrouter" },
    ];
    const result = sortCurrentFirst(shared, "m2", "anthropic");
    expect(result.map((m) => m.provider)).toEqual(["openrouter", "anthropic"]);
  });
});

describe("dedupeByModelKey", () => {
  it("drops later entries that repeat an earlier provider/id, keeping the first occurrence", () => {
    const withDupes = [
      { id: "m1", provider: "anthropic", label: "Model One (group A)" },
      { id: "m2", provider: "anthropic", label: "Model Two" },
      { id: "m1", provider: "anthropic", label: "Model One (group B)" },
    ];
    const result = dedupeByModelKey(withDupes);
    expect(result).toEqual([
      { id: "m1", provider: "anthropic", label: "Model One (group A)" },
      { id: "m2", provider: "anthropic", label: "Model Two" },
    ]);
  });

  it("keeps the same id under two different providers — they are distinct choices", () => {
    const shared = [
      { id: "m1", provider: "anthropic" },
      { id: "m1", provider: "openrouter" },
    ];
    expect(dedupeByModelKey(shared)).toEqual(shared);
  });

  it("collapses repeats among provider-less entries", () => {
    expect(dedupeByModelKey([{ id: "m1" }, { id: "m1" }])).toEqual([{ id: "m1" }]);
  });

  it("is a no-op when every id is already unique", () => {
    expect(dedupeByModelKey(models)).toEqual(models);
  });

  it("returns an empty list unchanged", () => {
    expect(dedupeByModelKey([])).toEqual([]);
  });

  it("composes with sortCurrentFirst — the current model's kept occurrence is the sorted-first one", () => {
    const withDupes = [
      { id: "m1", label: "Model One" },
      { id: "m2", label: "Model Two (group A)" },
      { id: "m2", label: "Model Two (group B)" },
    ];
    const result = dedupeByModelKey(sortCurrentFirst(withDupes, "m2"));
    expect(result).toEqual([
      { id: "m2", label: "Model Two (group A)" },
      { id: "m1", label: "Model One" },
    ]);
  });
});
