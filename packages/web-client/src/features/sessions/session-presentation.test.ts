import { describe, expect, it } from "vitest";
import { EMPTY_TIMELINE } from "@pi-studio-ui/timeline/reducer.js";
import type { TimelineRow } from "@pi-studio-ui/timeline/row-model.js";
import type { SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { statusDotColor } from "@pi-studio-ui/ui/status-dot.js";
import { sidebarSessionView, workspaceAttentionDot } from "./session-presentation.js";

let seq = 0;

function session(overrides: Partial<SessionEntry> = {}): SessionEntry {
  seq += 1;
  return {
    id: `session-${seq}`,
    agentId: `agent-${seq}`,
    title: "Untitled",
    status: "idle",
    cwd: "~/repo",
    timeline: EMPTY_TIMELINE,
    userMessageCount: 1,
    ...overrides,
  };
}

function errorRow(text: string): TimelineRow {
  return { kind: "error", id: `err-${Math.random()}`, text };
}

describe("sidebarSessionView", () => {
  it("maps error status to failed, taking precedence over everything else", () => {
    const view = sidebarSessionView(session({ status: "error", userMessageCount: 0 }));
    expect(view.state).toBe("failed");
    expect(view.meta).toBe("turn failed");
  });

  it("maps running status to running", () => {
    const view = sidebarSessionView(session({ status: "running" }));
    expect(view.state).toBe("running");
    expect(view.meta).toBe("running");
  });

  it("maps a never-used session (no user messages, no timeline rows) to empty", () => {
    const view = sidebarSessionView(session({ userMessageCount: 0, timeline: EMPTY_TIMELINE }));
    expect(view.state).toBe("empty");
    expect(view.meta).toBe("no messages");
  });

  it("maps everything else to idle", () => {
    const view = sidebarSessionView(session({ status: "idle" }));
    expect(view.state).toBe("idle");
    expect(view.meta).toBe("idle");
  });

  it("folds initializing into idle", () => {
    expect(sidebarSessionView(session({ status: "initializing" })).state).toBe("idle");
  });

  it("folds closed into idle", () => {
    expect(sidebarSessionView(session({ status: "closed" })).state).toBe("idle");
  });

  it("does not treat a session with rows but zero user messages as empty", () => {
    const timeline = { ...EMPTY_TIMELINE, rows: [errorRow("boom")] };
    const view = sidebarSessionView(session({ status: "idle", userMessageCount: 0, timeline }));
    expect(view.state).toBe("idle");
  });

  it("extracts the last error row's text as the failure reason", () => {
    const timeline = {
      ...EMPTY_TIMELINE,
      rows: [errorRow("first failure"), errorRow("second failure")],
    };
    const view = sidebarSessionView(session({ status: "error", timeline }));
    expect(view.reason).toBe("second failure");
  });

  it("takes only the first line of a multi-line error", () => {
    const timeline = { ...EMPTY_TIMELINE, rows: [errorRow("line one\nline two\nline three")] };
    const view = sidebarSessionView(session({ status: "error", timeline }));
    expect(view.reason).toBe("line one");
  });

  it("trims whitespace from the reason", () => {
    const timeline = { ...EMPTY_TIMELINE, rows: [errorRow("  spaced out  ")] };
    const view = sidebarSessionView(session({ status: "error", timeline }));
    expect(view.reason).toBe("spaced out");
  });

  it("caps the reason at 120 characters", () => {
    const long = "x".repeat(200);
    const timeline = { ...EMPTY_TIMELINE, rows: [errorRow(long)] };
    const view = sidebarSessionView(session({ status: "error", timeline }));
    expect(view.reason).toHaveLength(120);
    expect(view.reason).toBe("x".repeat(120));
  });

  it("yields a null reason when a failed session has no error row", () => {
    const view = sidebarSessionView(session({ status: "error", timeline: EMPTY_TIMELINE }));
    expect(view.reason).toBeNull();
    expect(view.meta).toBe("turn failed");
  });

  it("yields a null reason for every non-failed state", () => {
    for (const status of ["idle", "running", "initializing", "closed"] as const) {
      expect(sidebarSessionView(session({ status })).reason).toBeNull();
    }
  });

  it("yields a muted, showInactive dot for idle and empty", () => {
    for (const view of [
      sidebarSessionView(session({ status: "idle" })),
      sidebarSessionView(session({ userMessageCount: 0 })),
    ]) {
      expect(view.dot).toEqual({ status: "idle", showInactive: true });
      expect(statusDotColor(view.dot!)).toBe("foregroundMuted");
    }
  });

  it("yields a running dot input for running", () => {
    const view = sidebarSessionView(session({ status: "running" }));
    expect(view.dot).toEqual({ status: "running" });
  });

  it("yields a statusDanger-colored dot input for failed", () => {
    const view = sidebarSessionView(session({ status: "error" }));
    expect(view.dot).not.toBeNull();
    expect(statusDotColor(view.dot!)).toBe("statusDanger");
  });

  it("sets titleItalic only for empty", () => {
    expect(sidebarSessionView(session({ userMessageCount: 0 })).titleItalic).toBe(true);
    expect(sidebarSessionView(session({ status: "idle" })).titleItalic).toBe(false);
    expect(sidebarSessionView(session({ status: "running" })).titleItalic).toBe(false);
    expect(sidebarSessionView(session({ status: "error" })).titleItalic).toBe(false);
  });
});

describe("workspaceAttentionDot", () => {
  it("returns a statusDanger input when any child session failed", () => {
    const sessions = [session({ status: "idle" }), session({ status: "error" })];
    const dot = workspaceAttentionDot(sessions);
    expect(dot).not.toBeNull();
    expect(statusDotColor(dot!)).toBe("statusDanger");
  });

  it("returns null for a mix of running/idle/empty children", () => {
    const sessions = [
      session({ status: "running" }),
      session({ status: "idle" }),
      session({ userMessageCount: 0 }),
    ];
    expect(workspaceAttentionDot(sessions)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(workspaceAttentionDot([])).toBeNull();
  });
});
