import { describe, expect, it } from "vitest";
import type { AgentUiPendingEntry } from "@av-pi-studio/client";
import { deadline } from "./deadline.js";

function pending(overrides: Partial<AgentUiPendingEntry> = {}): AgentUiPendingEntry {
  return {
    requestId: "req-1",
    agentId: "agent-1",
    method: "select",
    payload: {},
    createdAt: 1000,
    receivedAt: 1000,
    answerable: true,
    ...overrides,
  };
}

describe("deadline", () => {
  it("show is false when timeoutMs is absent (no bar, no reserved space)", () => {
    expect(deadline(pending({ timeoutMs: undefined }), 5000)).toEqual({
      show: false,
      fraction: 0,
      approximate: false,
    });
  });

  it("show is true with a full fraction at the moment the dialog is received", () => {
    const entry = pending({ timeoutMs: 30_000, receivedAt: 1000 });
    expect(deadline(entry, 1000)).toEqual({ show: true, fraction: 1, approximate: false });
  });

  it("fraction only ever decreases for a fixed entry as `now` advances", () => {
    const entry = pending({ timeoutMs: 30_000, receivedAt: 1000 });
    const f1 = deadline(entry, 1000).fraction;
    const f2 = deadline(entry, 10_000).fraction;
    const f3 = deadline(entry, 20_000).fraction;
    const f4 = deadline(entry, 40_000).fraction; // past the deadline
    expect(f1).toBeGreaterThan(f2);
    expect(f2).toBeGreaterThan(f3);
    expect(f3).toBeGreaterThan(f4);
    expect(f4).toBe(0); // clamped, never negative
  });

  it("approximate is true when receivedAt is absent (snapshot-recovered entry)", () => {
    const entry = pending({ timeoutMs: 30_000, receivedAt: undefined, createdAt: 1000 });
    expect(deadline(entry, 1000).approximate).toBe(true);
  });

  it("approximate is false for a live entry with a local receivedAt", () => {
    const entry = pending({ timeoutMs: 30_000, receivedAt: 1000 });
    expect(deadline(entry, 1000).approximate).toBe(false);
  });

  it("a snapshot-recovered entry still anchors on the daemon's createdAt for its fraction", () => {
    const entry = pending({ timeoutMs: 30_000, receivedAt: undefined, createdAt: 1000 });
    expect(deadline(entry, 1000).fraction).toBe(1);
    expect(deadline(entry, 16_000).fraction).toBeCloseTo(0.5, 5);
  });

  // editor never carries a timeout on Pi's real wire — no special case needed, absent timeoutMs
  // already yields show: false.
  it("an editor entry (no timeoutMs) never shows a deadline", () => {
    expect(deadline(pending({ method: "editor", timeoutMs: undefined }), 1000).show).toBe(false);
  });
});
