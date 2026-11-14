import { describe, expect, it } from "vitest";
import type { ComboboxOption } from "./combobox.js";
import { groupOptions } from "./option-groups.js";

function opt(value: string, group?: string): ComboboxOption<string> {
  return { value, label: value, group };
}

const models = [
  opt("sonnet", "anthropic"),
  opt("gpt-5", "openai"),
  opt("opus", "anthropic"),
  opt("o3", "openai"),
];

describe("groupOptions", () => {
  it("sections options by group in first-appearance order, keeping each group's own order", () => {
    expect(groupOptions(models)).toEqual([
      {
        key: "anthropic",
        label: "anthropic",
        options: [opt("sonnet", "anthropic"), opt("opus", "anthropic")],
      },
      { key: "openai", label: "openai", options: [opt("gpt-5", "openai"), opt("o3", "openai")] },
    ]);
  });

  it("hoists priorityGroup to the front, leaving the rest in first-appearance order", () => {
    expect(groupOptions(models, { priorityGroup: "openai" }).map((g) => g.key)).toEqual([
      "openai",
      "anthropic",
    ]);
  });

  it("ignores a priorityGroup no option carries", () => {
    expect(groupOptions(models, { priorityGroup: "google" }).map((g) => g.key)).toEqual([
      "anthropic",
      "openai",
    ]);
  });

  it("puts ungrouped options last even when they appear first", () => {
    const groups = groupOptions([opt("loose"), opt("sonnet", "anthropic")], {
      ungroupedLabel: "Other",
    });
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ["anthropic", "anthropic"],
      ["", "Other"],
    ]);
  });

  it("leaves the ungrouped bucket headerless when no ungroupedLabel is given", () => {
    expect(groupOptions([opt("a"), opt("b")])).toEqual([
      { key: "", label: undefined, options: [opt("a"), opt("b")] },
    ]);
  });

  it("flattening the groups gives the render order a highlighted index must use", () => {
    const groups = groupOptions(models, { priorityGroup: "openai" });
    expect(groups.flatMap((g) => g.options).map((o) => o.value)).toEqual([
      "gpt-5",
      "o3",
      "sonnet",
      "opus",
    ]);
  });

  it("returns no groups for an empty option list", () => {
    expect(groupOptions([])).toEqual([]);
  });
});
