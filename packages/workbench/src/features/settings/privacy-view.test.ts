import { describe, expect, it } from "vitest";
import type { UsageBlockedReason } from "../../host/types.js";
import { privacyView, USAGE_DATA_SENT } from "./privacy-view.js";

describe("privacyView", () => {
  it("the switch follows enabled", () => {
    expect(privacyView({ enabled: true, sending: true }).checked).toBe(true);
    expect(privacyView({ enabled: false, sending: false }).checked).toBe(false);
  });

  it("shows no blocked line when this run can send", () => {
    expect(privacyView({ enabled: true, sending: true }).blockedLine).toBeNull();
  });

  it.each<[UsageBlockedReason, string]>([
    ["build", "This run sends nothing: this build is not a published release."],
    ["do_not_track", "This run sends nothing: DO_NOT_TRACK is set."],
    ["ci", "This run sends nothing: CI is set."],
    ["scripted", "This run sends nothing: the app was started by a script."],
  ])("explains blocked reason %s", (blocked, line) => {
    expect(privacyView({ enabled: true, sending: false, blocked }).blockedLine).toBe(line);
  });

  it("shows the ID line only when an ID exists", () => {
    expect(privacyView({ enabled: true, sending: true }).idLine).toBeNull();
    expect(privacyView({ enabled: true, sending: true, id: "abc-123" }).idLine).toBe(
      "Your anonymous ID: abc-123",
    );
  });

  it("lists what is sent", () => {
    expect(USAGE_DATA_SENT.length).toBeGreaterThan(0);
  });
});
