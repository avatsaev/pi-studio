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
    const view = sidebarSessionView(session({ status: "error", userMessageCount: 0 }), false);
    expect(view.state).toBe("failed");
    expect(view.meta).toBe("turn failed");
  });

  it("maps running status to running", () => {
    const view = sidebarSessionView(session({ status: "running" }), false);
    expect(view.state).toBe("running");
    expect(view.meta).toBe("running");
  });

  it("maps a never-used session (no user messages, no timeline rows) to empty", () => {
    const view = sidebarSessionView(
      session({ userMessageCount: 0, timeline: EMPTY_TIMELINE }),
      false,
    );
    expect(view.state).toBe("empty");
    expect(view.meta).toBe("no messages");
  });

  it("maps everything else to idle", () => {
    const view = sidebarSessionView(session({ status: "idle" }), false);
    expect(view.state).toBe("idle");
    expect(view.meta).toBe("idle");
  });

  it("folds initializing into idle", () => {
    expect(sidebarSessionView(session({ status: "initializing" }), false).state).toBe("idle");
  });

  it("folds closed into idle", () => {
    expect(sidebarSessionView(session({ status: "closed" }), false).state).toBe("idle");
  });

  it("does not treat a session with rows but zero user messages as empty", () => {
    const timeline = { ...EMPTY_TIMELINE, rows: [errorRow("boom")] };
    const view = sidebarSessionView(
      session({ status: "idle", userMessageCount: 0, timeline }),
      false,
    );
    expect(view.state).toBe("idle");
  });

  it("extracts the last error row's text as the failure reason", () => {
    const timeline = {
      ...EMPTY_TIMELINE,
      rows: [errorRow("first failure"), errorRow("second failure")],
    };
    const view = sidebarSessionView(session({ status: "error", timeline }), false);
    expect(view.reason).toBe("second failure");
  });

  it("takes only the first line of a multi-line error", () => {
    const timeline = { ...EMPTY_TIMELINE, rows: [errorRow("line one\nline two\nline three")] };
    const view = sidebarSessionView(session({ status: "error", timeline }), false);
    expect(view.reason).toBe("line one");
  });

  it("trims whitespace from the reason", () => {
    const timeline = { ...EMPTY_TIMELINE, rows: [errorRow("  spaced out  ")] };
    const view = sidebarSessionView(session({ status: "error", timeline }), false);
    expect(view.reason).toBe("spaced out");
  });

  it("caps the reason at 120 characters", () => {
    const long = "x".repeat(200);
    const timeline = { ...EMPTY_TIMELINE, rows: [errorRow(long)] };
    const view = sidebarSessionView(session({ status: "error", timeline }), false);
    expect(view.reason).toHaveLength(120);
    expect(view.reason).toBe("x".repeat(120));
  });

  it("yields a null reason when a failed session has no error row", () => {
    const view = sidebarSessionView(session({ status: "error", timeline: EMPTY_TIMELINE }), false);
    expect(view.reason).toBeNull();
    expect(view.meta).toBe("turn failed");
  });

  it("yields a null reason for every non-failed state", () => {
    for (const status of ["idle", "running", "initializing", "closed"] as const) {
      expect(sidebarSessionView(session({ status }), false).reason).toBeNull();
    }
  });

  it("yields a muted, showInactive dot for idle and empty", () => {
    for (const view of [
      sidebarSessionView(session({ status: "idle" }), false),
      sidebarSessionView(session({ userMessageCount: 0 }), false),
    ]) {
      expect(view.dot).toEqual({ status: "idle", showInactive: true });
      expect(statusDotColor(view.dot!)).toBe("foregroundMuted");
    }
  });

  it("yields a running dot input for running", () => {
    const view = sidebarSessionView(session({ status: "running" }), false);
    expect(view.dot).toEqual({ status: "running" });
  });

  it("yields a statusDanger-colored dot input for failed", () => {
    const view = sidebarSessionView(session({ status: "error" }), false);
    expect(view.dot).not.toBeNull();
    expect(statusDotColor(view.dot!)).toBe("statusDanger");
  });

  it("sets titleItalic only for empty", () => {
    expect(sidebarSessionView(session({ userMessageCount: 0 }), false).titleItalic).toBe(true);
    expect(sidebarSessionView(session({ status: "idle" }), false).titleItalic).toBe(false);
    expect(sidebarSessionView(session({ status: "running" }), false).titleItalic).toBe(false);
    expect(sidebarSessionView(session({ status: "error" }), false).titleItalic).toBe(false);
  });

  it("sources needs-input from hasPendingQuestion and wins over running (§ 08)", () => {
    const view = sidebarSessionView(session({ status: "running" }), true);
    expect(view.state).toBe("needsInput");
    expect(view.meta).toBe("needs input");
  });

  it("sources needs-input for an otherwise-idle session", () => {
    const view = sidebarSessionView(session({ status: "idle" }), true);
    expect(view.state).toBe("needsInput");
  });

  it("failed still wins over a pending question", () => {
    const view = sidebarSessionView(session({ status: "error" }), true);
    expect(view.state).toBe("failed");
  });

  it("clears the moment hasPendingQuestion goes false, regardless of status", () => {
    expect(sidebarSessionView(session({ status: "running" }), false).state).toBe("running");
    expect(sidebarSessionView(session({ status: "idle" }), false).state).toBe("idle");
  });

  it("yields a statusWarning-colored, attention-flagged dot with the 'question' reason", () => {
    const view = sidebarSessionView(session({ status: "idle" }), true);
    expect(view.dot).toEqual({
      status: "idle",
      requiresAttention: true,
      attentionReason: "question",
    });
    expect(statusDotColor(view.dot!)).toBe("statusWarning");
  });

  it("suppresses the running spinner in favor of the flat warning dot", () => {
    // StatusDot.tsx spins only when `status === "running" && !requiresAttention` — needs-input
    // sets `requiresAttention`, so even a `status: "running"` dot input must not spin.
    const view = sidebarSessionView(session({ status: "running" }), true);
    expect(view.dot?.requiresAttention).toBe(true);
  });

  it("does not italicize the title for needs-input", () => {
    expect(sidebarSessionView(session({ userMessageCount: 0 }), true).titleItalic).toBe(false);
  });
});

describe("workspaceAttentionDot", () => {
  it("returns a statusDanger dot with reason 'failed' when a child failed and nothing is pending", () => {
    const sessions = [session({ status: "idle" }), session({ status: "error" })];
    const info = workspaceAttentionDot(sessions, new Set());
    expect(info).not.toBeNull();
    expect(info!.reason).toBe("failed");
    expect(statusDotColor(info!.dot)).toBe("statusDanger");
  });

  it("returns null for a mix of running/idle/empty children with nothing pending", () => {
    const sessions = [
      session({ status: "running" }),
      session({ status: "idle" }),
      session({ userMessageCount: 0 }),
    ];
    expect(workspaceAttentionDot(sessions, new Set())).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(workspaceAttentionDot([], new Set())).toBeNull();
  });

  it("sources needs-input from pendingAgentIds and wins over a failed sibling (§ 08 precedence)", () => {
    const pending = session({ status: "idle", agentId: "a-pending" });
    const failed = session({ status: "error", agentId: "a-failed" });
    const info = workspaceAttentionDot([pending, failed], new Set(["a-pending"]));
    expect(info).not.toBeNull();
    expect(info!.reason).toBe("question");
    expect(statusDotColor(info!.dot)).toBe("statusWarning");
  });

  it("counts sessions with a pending question, not questions — one session counts once", () => {
    const s1 = session({ status: "idle", agentId: "a1" });
    const s2 = session({ status: "idle", agentId: "a2" });
    const info = workspaceAttentionDot([s1, s2], new Set(["a1", "a2"]));
    expect(info!.pendingSessionCount).toBe(2);
  });

  it("does not count a session whose agent has no pending entry", () => {
    const pending = session({ status: "idle", agentId: "a-pending" });
    const idle = session({ status: "idle", agentId: "a-idle" });
    const info = workspaceAttentionDot([pending, idle], new Set(["a-pending"]));
    expect(info!.pendingSessionCount).toBe(1);
  });

  it("clears (returns null) once pendingAgentIds no longer includes any child and nothing failed", () => {
    const s1 = session({ status: "idle", agentId: "a1" });
    expect(workspaceAttentionDot([s1], new Set())).toBeNull();
  });
});
