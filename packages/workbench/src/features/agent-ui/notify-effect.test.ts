import { describe, expect, it } from "vitest";
import {
  notifyAnnouncement,
  notifyDurationMs,
  notifyToastCopy,
  notifyVariant,
} from "./notify-effect.js";

describe("notifyVariant", () => {
  it("maps warning and error to their variants", () => {
    expect(notifyVariant("warning")).toBe("warning");
    expect(notifyVariant("error")).toBe("error");
  });

  it("maps info, and any unrecognised level, to default", () => {
    expect(notifyVariant("info")).toBe("default");
    expect(notifyVariant("bogus")).toBe("default");
    expect(notifyVariant("")).toBe("default");
  });
});

describe("notifyDurationMs", () => {
  it("info dwells 4s, warning 6s, error is sticky", () => {
    expect(notifyDurationMs("info")).toBe(4000);
    expect(notifyDurationMs("warning")).toBe(6000);
    expect(notifyDurationMs("error")).toBeNull();
  });

  it("an unrecognised level dwells like info, not sticky", () => {
    expect(notifyDurationMs("bogus")).toBe(4000);
  });
});

describe("notifyToastCopy", () => {
  it("returns the bare message for the active session", () => {
    expect(notifyToastCopy("Sync complete.", "agent-1", "agent-1", "Refactor auth")).toBe(
      "Sync complete.",
    );
  });

  it("prefixes with the session title as a locator for a background session", () => {
    expect(notifyToastCopy("Sync complete.", "agent-2", "agent-1", "Refactor auth")).toBe(
      "Refactor auth — Sync complete.",
    );
  });

  it("falls back to 'Chat' when the session title is unknown", () => {
    expect(notifyToastCopy("Sync complete.", "agent-2", "agent-1", null)).toBe(
      "Chat — Sync complete.",
    );
  });

  it("falls back to 'Chat' when the session title is an empty string", () => {
    expect(notifyToastCopy("Sync complete.", "agent-2", "agent-1", "")).toBe(
      "Chat — Sync complete.",
    );
  });

  it("treats a null active session as background for any effect agent", () => {
    expect(notifyToastCopy("Sync complete.", "agent-2", null, "Refactor auth")).toBe(
      "Refactor auth — Sync complete.",
    );
  });
});
describe("notifyAnnouncement", () => {
  it("returns the bare message, politely, for the active session", () => {
    expect(
      notifyAnnouncement("Sync complete.", "info", "agent-1", "agent-1", "Refactor auth"),
    ).toEqual({ text: "Sync complete.", politeness: "polite" });
  });

  it("prefixes with a colon-separated session locator for a background session", () => {
    expect(
      notifyAnnouncement("Sync complete.", "info", "agent-2", "agent-1", "Refactor auth"),
    ).toEqual({ text: "Refactor auth: Sync complete.", politeness: "polite" });
  });

  it("falls back to 'Chat' when the session title is unknown", () => {
    expect(notifyAnnouncement("Sync complete.", "info", "agent-2", "agent-1", null)).toEqual({
      text: "Chat: Sync complete.",
      politeness: "polite",
    });
  });

  it("error level is assertive, in the active session too", () => {
    expect(
      notifyAnnouncement("Rate limit approaching.", "error", "agent-1", "agent-1", "Refactor auth"),
    ).toEqual({ text: "Rate limit approaching.", politeness: "assertive" });
  });

  it("warning level is polite, matching info", () => {
    expect(
      notifyAnnouncement("Low disk space.", "warning", "agent-2", "agent-1", "Refactor auth"),
    ).toEqual({ text: "Refactor auth: Low disk space.", politeness: "polite" });
  });

  it("an unrecognised level behaves like info: polite", () => {
    expect(
      notifyAnnouncement("Sync complete.", "bogus", "agent-1", "agent-1", "Refactor auth"),
    ).toEqual({ text: "Sync complete.", politeness: "polite" });
  });
});
