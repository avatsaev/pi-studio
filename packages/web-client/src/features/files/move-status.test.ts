import { describe, expect, it } from "vitest";
import { withClosedDiffs } from "./move-status.js";

describe("withClosedDiffs", () => {
  it("returns the text unchanged when no diff tabs were closed", () => {
    expect(withClosedDiffs("Moved to /", 0)).toBe("Moved to /");
  });

  it("renders the singular form for exactly one closed diff tab", () => {
    expect(withClosedDiffs("Moved to /", 1)).toBe("Moved to / — closed 1 diff tab");
  });

  it("renders the plural form for more than one closed diff tab", () => {
    expect(withClosedDiffs("Moved to /", 2)).toBe("Moved to / — closed 2 diff tabs");
  });

  it("never mutates the base text it is given", () => {
    const text = "Moved to /";
    withClosedDiffs(text, 3);
    expect(text).toBe("Moved to /");
  });
});
