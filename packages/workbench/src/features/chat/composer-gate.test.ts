import { describe, expect, it } from "vitest";
import {
  canCompact,
  canSubmitDraft,
  shouldRestoreCompactDraft,
  type SubmitGateInput,
} from "./composer-gate.js";

const idle: SubmitGateInput = {
  hasClient: true,
  busy: false,
  compacting: false,
  running: false,
  hasAgent: true,
  text: "hello",
  hasImages: false,
};

describe("canSubmitDraft", () => {
  it("allows an ordinary draft on an idle agent", () => {
    expect(canSubmitDraft(idle)).toBe(true);
  });

  it("blocks every draft while compacting, including steering a running turn", () => {
    expect(canSubmitDraft({ ...idle, compacting: true })).toBe(false);
    expect(canSubmitDraft({ ...idle, compacting: true, running: true })).toBe(false);
    expect(canSubmitDraft({ ...idle, compacting: true, text: "/compact" })).toBe(false);
  });

  it("while running, an ordinary draft still steers but /compact cannot be submitted", () => {
    expect(canSubmitDraft({ ...idle, running: true })).toBe(true);
    expect(canSubmitDraft({ ...idle, running: true, text: "/compact" })).toBe(false);
    expect(canSubmitDraft({ ...idle, running: true, text: "/compact focus on X" })).toBe(false);
  });

  it("a /compact draft needs an agent; an agent-less ordinary draft is still sendable (it creates one)", () => {
    expect(canSubmitDraft({ ...idle, hasAgent: false, text: "/compact" })).toBe(false);
    expect(canSubmitDraft({ ...idle, hasAgent: false })).toBe(true);
  });

  it("/compact on an idle agent is submittable, with or without instructions", () => {
    expect(canSubmitDraft({ ...idle, text: "/compact" })).toBe(true);
    expect(canSubmitDraft({ ...idle, text: "/compact focus on X" })).toBe(true);
  });

  it("near-misses are ordinary drafts, so a running agent can still steer them", () => {
    expect(canSubmitDraft({ ...idle, running: true, text: "/Compact" })).toBe(true);
    expect(canSubmitDraft({ ...idle, running: true, text: "/compactx" })).toBe(true);
  });

  it("needs a client, content, and no in-flight send/steer", () => {
    expect(canSubmitDraft({ ...idle, hasClient: false })).toBe(false);
    expect(canSubmitDraft({ ...idle, text: "   " })).toBe(false);
    expect(canSubmitDraft({ ...idle, text: "", hasImages: true })).toBe(true);
    expect(canSubmitDraft({ ...idle, busy: true })).toBe(false);
  });
});

describe("canCompact", () => {
  it("requires an idle, non-compacting agent", () => {
    expect(canCompact({ running: false, compacting: false, hasAgent: true })).toBe(true);
    expect(canCompact({ running: true, compacting: false, hasAgent: true })).toBe(false);
    expect(canCompact({ running: false, compacting: true, hasAgent: true })).toBe(false);
    expect(canCompact({ running: false, compacting: false, hasAgent: false })).toBe(false);
  });
});

describe("shouldRestoreCompactDraft", () => {
  it("puts the draft back only when nothing was compacted", () => {
    expect(shouldRestoreCompactDraft({ ok: false, reason: "failed", message: "x" }, "")).toBe(true);
    expect(shouldRestoreCompactDraft({ ok: false, reason: "disconnected" }, "")).toBe(true);
    expect(shouldRestoreCompactDraft({ ok: true }, "")).toBe(false);
  });

  it("a user cancel is not restored", () => {
    expect(shouldRestoreCompactDraft({ ok: false, reason: "canceled" }, "")).toBe(false);
  });

  it("never clobbers a draft written while the compaction ran", () => {
    const failed = { ok: false, reason: "failed", message: "x" } as const;
    expect(shouldRestoreCompactDraft(failed, "filled by an extension")).toBe(false);
  });
});
