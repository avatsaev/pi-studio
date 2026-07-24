import { describe, expect, it } from "vitest";
import { sortCurrentFirst, dedupeById } from "./model-menu-sort.js";

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
});

describe("dedupeById", () => {
  it("drops later entries that repeat an earlier id, keeping the first occurrence", () => {
    const withDupes = [
      { id: "m1", label: "Model One (group A)" },
      { id: "m2", label: "Model Two" },
      { id: "m1", label: "Model One (group B)" },
    ];
    const result = dedupeById(withDupes);
    expect(result).toEqual([
      { id: "m1", label: "Model One (group A)" },
      { id: "m2", label: "Model Two" },
    ]);
  });

  it("is a no-op when every id is already unique", () => {
    expect(dedupeById(models)).toEqual(models);
  });

  it("returns an empty list unchanged", () => {
    expect(dedupeById([])).toEqual([]);
  });

  it("composes with sortCurrentFirst — the current model's kept occurrence is the sorted-first one", () => {
    const withDupes = [
      { id: "m1", label: "Model One" },
      { id: "m2", label: "Model Two (group A)" },
      { id: "m2", label: "Model Two (group B)" },
    ];
    const result = dedupeById(sortCurrentFirst(withDupes, "m2"));
    expect(result).toEqual([
      { id: "m2", label: "Model Two (group A)" },
      { id: "m1", label: "Model One" },
    ]);
  });
});
