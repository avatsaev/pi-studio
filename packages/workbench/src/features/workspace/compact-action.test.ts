import { describe, expect, it } from "vitest";
import { compactAction } from "./compact-action.js";

const ok = { compacting: false, running: false, hasAgent: true, connected: true };

describe("compactAction priority", () => {
  it("compacting always wins (Cancel), even when other conditions would disable", () => {
    expect(compactAction({ ...ok, compacting: true, running: true, hasAgent: false })).toEqual({
      kind: "cancel",
    });
  });

  it("running disables with the wait note", () => {
    expect(compactAction({ ...ok, running: true })).toEqual({
      kind: "disabled",
      note: "Wait for the agent to finish",
    });
  });

  it("no agent disables with the nothing-to-compact note, ahead of running", () => {
    expect(compactAction({ ...ok, hasAgent: false, running: true })).toEqual({
      kind: "disabled",
      note: "Nothing to compact yet",
    });
  });

  it("disconnected disables, otherwise Compact now is available", () => {
    expect(compactAction({ ...ok, connected: false })).toMatchObject({ kind: "disabled" });
    expect(compactAction(ok)).toEqual({ kind: "compact" });
  });
});
