import { describe, expect, it } from "vitest";
import type { AgentUiPendingEntry, AgentUiResolvedEntry, AgentUiState } from "@av-pi-studio/client";
import { computeAnnouncements, type AnnouncementContext } from "./announce.js";

function state(overrides: Partial<AgentUiState> = {}): AgentUiState {
  return { pending: {}, surfaces: {}, resolved: {}, ...overrides };
}

function pending(overrides: Partial<AgentUiPendingEntry> = {}): AgentUiPendingEntry {
  return {
    requestId: "req-1",
    agentId: "agent-1",
    method: "confirm",
    payload: { title: "Allow this extension to modify /etc/hosts?" },
    createdAt: 1,
    receivedAt: 1000,
    answerable: true,
    ...overrides,
  };
}

function resolved(overrides: Partial<AgentUiResolvedEntry> = {}): AgentUiResolvedEntry {
  return {
    requestId: "req-1",
    agentId: "agent-1",
    method: "confirm",
    payload: {},
    createdAt: 1,
    reason: "answered",
    ...overrides,
  };
}

const titles: Record<string, string> = {
  "agent-1": "skill: connectivity",
  "agent-2": "Refactor auth",
};

function ctx(activeAgentId: string | null): AnnouncementContext {
  return {
    activeAgentId,
    sessionTitle: (agentId) => titles[agentId] ?? null,
  };
}

describe("computeAnnouncements — § 08 pending-question arrivals", () => {
  it("active session: includes the prompt", () => {
    const prev = state();
    const next = state({ pending: { "req-1": pending() } });
    expect(computeAnnouncements(prev, next, ctx("agent-1"))).toEqual([
      {
        text: "A question needs input: Allow this extension to modify /etc/hosts?",
        politeness: "polite",
      },
    ]);
  });

  it("active session with no title in the payload: omits the colon entirely", () => {
    const prev = state();
    const next = state({ pending: { "req-1": pending({ payload: {} }) } });
    expect(computeAnnouncements(prev, next, ctx("agent-1"))).toEqual([
      { text: "A question needs input", politeness: "polite" },
    ]);
  });

  it("another (background) session: uses the session-name locator, never the prompt", () => {
    const prev = state();
    const next = state({ pending: { "req-1": pending({ agentId: "agent-2" }) } });
    expect(computeAnnouncements(prev, next, ctx("agent-1"))).toEqual([
      { text: "A question needs input in Refactor auth", politeness: "polite" },
    ]);
  });

  it("falls back to 'Chat' when the session title is unknown", () => {
    const prev = state();
    const next = state({ pending: { "req-1": pending({ agentId: "agent-9" }) } });
    expect(computeAnnouncements(prev, next, ctx("agent-1"))).toEqual([
      { text: "A question needs input in Chat", politeness: "polite" },
    ]);
  });

  it("second pending question in the same session: count form, even when active", () => {
    const prev = state({ pending: { "req-1": pending() } });
    const next = state({
      pending: { "req-1": pending(), "req-2": pending({ requestId: "req-2" }) },
    });
    expect(computeAnnouncements(prev, next, ctx("agent-1"))).toEqual([
      { text: "2 questions need input in skill: connectivity", politeness: "polite" },
    ]);
  });

  it("third pending question in the same session: count form bumps again", () => {
    const prev = state({
      pending: { "req-1": pending(), "req-2": pending({ requestId: "req-2" }) },
    });
    const next = state({
      pending: {
        "req-1": pending(),
        "req-2": pending({ requestId: "req-2" }),
        "req-3": pending({ requestId: "req-3" }),
      },
    });
    expect(computeAnnouncements(prev, next, ctx(null))).toEqual([
      { text: "3 questions need input in skill: connectivity", politeness: "polite" },
    ]);
  });

  it("a snapshot/resync-recovered entry (no receivedAt) never announces an arrival", () => {
    const prev = state();
    const next = state({ pending: { "req-1": pending({ receivedAt: undefined }) } });
    expect(computeAnnouncements(prev, next, ctx("agent-1"))).toEqual([]);
  });

  it("an entry already present in the previous state is not a new arrival", () => {
    const entry = pending();
    const prev = state({ pending: { "req-1": entry } });
    const next = state({ pending: { "req-1": entry } });
    expect(computeAnnouncements(prev, next, ctx("agent-1"))).toEqual([]);
  });
});

describe("computeAnnouncements — § 08 resolutions", () => {
  it("answered (input): generic 'Answered', never a typed value", () => {
    const prev = state({ pending: { "req-1": pending({ method: "input" }) } });
    const next = state({
      resolved: { "req-1": resolved({ method: "input", reason: "answered" }) },
    });
    expect(computeAnnouncements(prev, next, ctx(null))).toEqual([
      { text: "Answered in skill: connectivity", politeness: "polite" },
    ]);
  });

  it("select answered here: never echoes the chosen option, even a secret-looking one", () => {
    const prev = state();
    const next = state({
      resolved: {
        "req-1": resolved({
          method: "select",
          reason: "answered",
          answer: { value: "sk-live-SECRET-TOKEN-XYZ" },
        }),
      },
    });
    const [announcement] = computeAnnouncements(prev, next, ctx(null));
    expect(announcement?.text).toBe("Answered in skill: connectivity");
    expect(announcement?.text).not.toContain("SECRET");
    expect(announcement?.text).not.toContain("sk-live");
  });

  it("editor submitted: never echoes typed text, even a secret-looking one", () => {
    const prev = state();
    // `agent-ui-state.ts`'s `answerFromResponse` never retains an editor answer in the first
    // place — this fixture proves the announcement is safe even given a resolved-entry shape
    // that somehow carried one, not merely that the SDK happens not to produce it today.
    const next = state({
      resolved: {
        "req-1": resolved({
          method: "editor",
          reason: "answered",
          payload: { prefill: "password: hunter2-do-not-log" },
        }),
      },
    });
    const [announcement] = computeAnnouncements(prev, next, ctx(null));
    expect(announcement?.text).toBe("Answered in skill: connectivity");
    expect(announcement?.text).not.toContain("hunter2");
  });

  it("confirm answered no: 'Dismissed'", () => {
    const prev = state();
    const next = state({
      resolved: {
        "req-1": resolved({ method: "confirm", reason: "answered", answer: { confirmed: false } }),
      },
    });
    expect(computeAnnouncements(prev, next, ctx(null))).toEqual([
      { text: "Dismissed in skill: connectivity", politeness: "polite" },
    ]);
  });

  it("cancelled: 'Dismissed'", () => {
    const prev = state();
    const next = state({ resolved: { "req-1": resolved({ reason: "cancelled" }) } });
    expect(computeAnnouncements(prev, next, ctx(null))).toEqual([
      { text: "Dismissed in skill: connectivity", politeness: "polite" },
    ]);
  });

  it("timeout: 'Expired'", () => {
    const prev = state();
    const next = state({ resolved: { "req-1": resolved({ reason: "timeout" }) } });
    expect(computeAnnouncements(prev, next, ctx(null))).toEqual([
      { text: "Expired in skill: connectivity", politeness: "polite" },
    ]);
  });

  it("select/confirm answered with no local answer (resolved elsewhere): 'No longer pending'", () => {
    const prev = state();
    const next = state({
      resolved: { "req-1": resolved({ method: "select", reason: "answered", answer: undefined }) },
    });
    expect(computeAnnouncements(prev, next, ctx(null))).toEqual([
      { text: "No longer pending in skill: connectivity", politeness: "polite" },
    ]);
  });

  it("an unrecognised reason: also 'No longer pending', never printed verbatim", () => {
    const prev = state();
    const next = state({ resolved: { "req-1": resolved({ reason: "aborted" }) } });
    expect(computeAnnouncements(prev, next, ctx(null))).toEqual([
      { text: "No longer pending in skill: connectivity", politeness: "polite" },
    ]);
  });

  it("an entry already resolved in the previous state does not re-announce", () => {
    const entry = resolved();
    const prev = state({ resolved: { "req-1": entry } });
    const next = state({ resolved: { "req-1": entry } });
    expect(computeAnnouncements(prev, next, ctx(null))).toEqual([]);
  });

  it("falls back to 'Chat' when the resolved entry's session title is unknown", () => {
    const prev = state();
    const next = state({
      resolved: {
        "req-1": resolved({ agentId: "agent-9", method: "confirm", answer: { confirmed: true } }),
      },
    });
    expect(computeAnnouncements(prev, next, ctx(null))).toEqual([
      { text: "Answered in Chat", politeness: "polite" },
    ]);
  });
});

describe("computeAnnouncements — no extension identity, never announces absence", () => {
  it("an identical state produces no announcements at all", () => {
    expect(computeAnnouncements(state(), state(), ctx(null))).toEqual([]);
  });

  it("no announcement string ever mentions the resolving method as an identity (only session name)", () => {
    const prev = state();
    const next = state({
      resolved: { "req-1": resolved({ method: "select", answer: { value: "Allow" } }) },
    });
    const [announcement] = computeAnnouncements(prev, next, ctx(null));
    expect(announcement?.text).toBe("Answered in skill: connectivity");
  });
});
