import { describe, expect, it } from "vitest";
import { formatMetaTime } from "./format-meta-time.js";

describe("formatMetaTime", () => {
  it("formats an ISO timestamp as 'Mon D, HH:MM' in local time, no seconds", () => {
    const date = new Date(2026, 7, 17, 9, 41, 12); // local Aug 17 2026, 09:41:12
    expect(formatMetaTime(date.toISOString())).toBe("Aug 17, 09:41");
  });

  it("zero-pads single-digit hour/minute but not the day", () => {
    const date = new Date(2026, 0, 1, 1, 2, 3);
    expect(formatMetaTime(date.toISOString())).toBe("Jan 1, 01:02");
  });

  it("returns undefined for a missing timestamp", () => {
    expect(formatMetaTime(undefined)).toBeUndefined();
  });

  it("returns undefined for an unparseable timestamp", () => {
    expect(formatMetaTime("not-a-date")).toBeUndefined();
  });
});
