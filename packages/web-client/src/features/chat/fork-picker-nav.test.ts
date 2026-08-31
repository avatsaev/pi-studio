import { describe, expect, it } from "vitest";
import { nextPickerFocusIndex } from "./fork-picker-nav.js";

describe("nextPickerFocusIndex", () => {
  it("moves down one row from the middle", () => {
    expect(nextPickerFocusIndex(1, "ArrowDown", 5)).toBe(2);
  });

  it("moves up one row from the middle", () => {
    expect(nextPickerFocusIndex(2, "ArrowUp", 5)).toBe(1);
  });

  it("clamps at the last row rather than wrapping to the first", () => {
    expect(nextPickerFocusIndex(4, "ArrowDown", 5)).toBe(4);
  });

  it("clamps at the first row rather than wrapping to the last", () => {
    expect(nextPickerFocusIndex(0, "ArrowUp", 5)).toBe(0);
  });

  it("is a no-op (returns the same index) with a single row", () => {
    expect(nextPickerFocusIndex(0, "ArrowDown", 1)).toBe(0);
    expect(nextPickerFocusIndex(0, "ArrowUp", 1)).toBe(0);
  });

  it("returns -1 (nothing to focus) when there are no rows", () => {
    expect(nextPickerFocusIndex(-1, "ArrowDown", 0)).toBe(-1);
  });

  it("treats an unresolved current index (-1, nothing focused yet) as before the first row", () => {
    expect(nextPickerFocusIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(nextPickerFocusIndex(-1, "ArrowUp", 3)).toBe(0);
  });
});
