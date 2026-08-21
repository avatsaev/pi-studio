import { describe, expect, it } from "vitest";
import { tabAttentionStatus } from "./tab-attention.js";
import { statusDotColor } from "@pi-studio-ui/ui/status-dot.js";
import type { Tab, TabKind } from "@pi-studio-ui/stores/tab-store.js";

function chatTab(id = "t1"): Tab {
  return {
    id,
    kind: "chat",
    label: id,
    closable: true,
    data: { sessionId: `s-${id}` },
    workspaceCwd: "/work",
  };
}

function nonChatTab(kind: Exclude<TabKind, "chat">, id = "t1"): Tab {
  const data =
    kind === "file"
      ? { path: "/a" }
      : kind === "diff"
        ? { path: "/a", staged: false }
        : kind === "terminal"
          ? { slot: null, cwd: "/work" }
          : { path: null };
  return { id, kind, label: id, closable: true, data, workspaceCwd: "/work" };
}

const NON_CHAT_KINDS: Exclude<TabKind, "chat">[] = ["file", "diff", "terminal", "molecule"];

describe("tabAttentionStatus", () => {
  it("returns null for every non-chat kind regardless of status/active/pending", () => {
    for (const kind of NON_CHAT_KINDS) {
      expect(tabAttentionStatus(nonChatTab(kind), "running", false, false)).toBeNull();
      expect(tabAttentionStatus(nonChatTab(kind), "error", true, true)).toBeNull();
    }
  });

  it("returns null for a chat tab that is its pane's active tab, at any status", () => {
    for (const status of ["initializing", "idle", "running", "error", "closed"] as const) {
      expect(tabAttentionStatus(chatTab(), status, true, false)).toBeNull();
    }
  });

  it("returns null for the active tab even with a pending question", () => {
    expect(tabAttentionStatus(chatTab(), "idle", true, true)).toBeNull();
  });

  it("returns null when the session hasn't landed in the store yet (offline restore gap)", () => {
    expect(() => tabAttentionStatus(chatTab(), undefined, false, false)).not.toThrow();
    expect(tabAttentionStatus(chatTab(), undefined, false, false)).toBeNull();
  });

  it("maps every protocol status for an inactive chat tab, with no pending question", () => {
    expect(tabAttentionStatus(chatTab(), "running", false, false)).toEqual({ status: "running" });
    expect(tabAttentionStatus(chatTab(), "error", false, false)).toEqual({ status: "error" });
    expect(tabAttentionStatus(chatTab(), "idle", false, false)).toBeNull();
    expect(tabAttentionStatus(chatTab(), "initializing", false, false)).toBeNull();
    expect(tabAttentionStatus(chatTab(), "closed", false, false)).toBeNull();
  });

  it("sources needs-input from a pending question, independent of sessionStatus", () => {
    for (const status of ["idle", "running", "error", "initializing", "closed"] as const) {
      const attention = tabAttentionStatus(chatTab(), status, false, true);
      expect(attention).toEqual({
        status: "waiting",
        requiresAttention: true,
        attentionReason: "question",
      });
      expect(statusDotColor(attention!)).toBe("statusWarning");
    }
  });

  it("sources needs-input even when the session hasn't landed yet (agent-ui store is independent)", () => {
    const attention = tabAttentionStatus(chatTab(), undefined, false, true);
    expect(attention).toEqual({
      status: "waiting",
      requiresAttention: true,
      attentionReason: "question",
    });
  });
});
