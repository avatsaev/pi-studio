import { describe, expect, it } from "vitest";
import { statusDotColor, type StatusDotColor, type StatusDotInput } from "./status-dot.js";

describe("statusDotColor", () => {
  it("returns null for a missing status", () => {
    expect(statusDotColor({ status: null })).toBeNull();
    expect(statusDotColor({ status: undefined })).toBeNull();
  });

  it("maps each base status to its token", () => {
    const cases: Array<[StatusDotInput["status"], StatusDotColor]> = [
      ["running", "accent"],
      ["queued", "accent"],
      ["waiting", "statusWarning"],
      ["finished", "statusSuccess"],
      ["error", "statusDanger"],
    ];
    for (const [status, expected] of cases) {
      expect(statusDotColor({ status })).toBe(expected);
    }
  });

  it("returns null for idle/archived unless showInactive", () => {
    expect(statusDotColor({ status: "idle" })).toBeNull();
    expect(statusDotColor({ status: "archived" })).toBeNull();
    expect(statusDotColor({ status: "idle", showInactive: true })).toBe("foregroundMuted");
    expect(statusDotColor({ status: "archived", showInactive: true })).toBe("foregroundMuted");
  });

  it("requiresAttention overrides the base status color", () => {
    expect(
      statusDotColor({ status: "running", requiresAttention: true, attentionReason: "error" }),
    ).toBe("statusDanger");
  });

  it("maps 'permission' and the sprint-069 'question' reason to the same statusWarning token", () => {
    expect(
      statusDotColor({
        status: "idle",
        requiresAttention: true,
        attentionReason: "permission",
      }),
    ).toBe("statusWarning");
    expect(
      statusDotColor({
        status: "idle",
        requiresAttention: true,
        attentionReason: "question",
      }),
    ).toBe("statusWarning");
  });

  it("'question' and 'permission' are distinct reasons that both resolve to the same color", () => {
    // The two concepts are deliberately kept apart at the type level (features/extension-ui-rpc.md)
    // even though today they share a color — a future divergence must not require touching every
    // caller that only cares about the color.
    const question = statusDotColor({
      status: "idle",
      requiresAttention: true,
      attentionReason: "question",
    });
    const permission = statusDotColor({
      status: "idle",
      requiresAttention: true,
      attentionReason: "permission",
    });
    expect(question).toBe(permission);
  });

  it("defaults an unrecognised/absent attentionReason under requiresAttention to statusSuccess", () => {
    expect(statusDotColor({ status: "idle", requiresAttention: true })).toBe("statusSuccess");
    expect(
      statusDotColor({ status: "idle", requiresAttention: true, attentionReason: "finished" }),
    ).toBe("statusSuccess");
  });
});
