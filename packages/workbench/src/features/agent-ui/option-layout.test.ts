import { describe, expect, it } from "vitest";
import { optionLayout } from "./option-layout.js";

// § 12 "NINE OPTIONS · SCROLLS AT SIX" — verbatim.
const NINE_OPTIONS = [
  "staging-eu",
  "staging-us",
  "prod-eu",
  "prod-us",
  "prod-apac",
  "canary-1",
  "canary-2",
  "local",
  "dry-run",
];

describe("optionLayout", () => {
  it("two short options (§ 03 side-by-side case): row, no scroll", () => {
    expect(optionLayout(["Allow", "Block"])).toEqual({ mode: "row", scrolls: false });
  });

  it("§ 12 EXACT STACKING THRESHOLD: one long option (>40 chars) forces stack even with only two options", () => {
    const options = [
      "Apply now and rebuild the search index in the background, keeping the current schema readable",
      "Wait",
    ];
    expect(options[0]!.length).toBeGreaterThan(40);
    expect(optionLayout(options)).toEqual({ mode: "stack", scrolls: false });
  });

  it("five or more options stack regardless of length", () => {
    expect(optionLayout(["a", "b", "c", "d", "e"])).toEqual({ mode: "stack", scrolls: false });
  });

  it("four short options stay row (below the 5-option stack threshold)", () => {
    expect(optionLayout(["a", "b", "c", "d"])).toEqual({ mode: "row", scrolls: false });
  });

  it("§ 12 nine-option case: stacks and scrolls", () => {
    expect(optionLayout(NINE_OPTIONS)).toEqual({ mode: "stack", scrolls: true });
  });

  it("exactly six options stacks (count threshold) but does not scroll yet", () => {
    expect(optionLayout(["a", "b", "c", "d", "e", "f"])).toEqual({ mode: "stack", scrolls: false });
  });

  it("exactly seven options scrolls", () => {
    expect(optionLayout(["a", "b", "c", "d", "e", "f", "g"])).toEqual({
      mode: "stack",
      scrolls: true,
    });
  });

  it("an empty array is handled without throwing: row, no scroll", () => {
    expect(optionLayout([])).toEqual({ mode: "row", scrolls: false });
  });

  it("duplicate identical labels produce identical layout output with no dedup, no ordinal", () => {
    const a = optionLayout(["main", "main", "detached"]);
    const b = optionLayout(["main", "main", "detached"]);
    expect(a).toEqual(b);
    expect(a).toEqual({ mode: "row", scrolls: false });
  });
});
