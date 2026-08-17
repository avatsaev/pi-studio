import { describe, expect, it } from "vitest";
import { tabAttentionStatus } from "./tab-attention.js";
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
  it("returns null for every non-chat kind regardless of status/active", () => {
    for (const kind of NON_CHAT_KINDS) {
      expect(tabAttentionStatus(nonChatTab(kind), "running", false)).toBeNull();
      expect(tabAttentionStatus(nonChatTab(kind), "error", true)).toBeNull();
    }
  });

  it("returns null for a chat tab that is its pane's active tab, at any status", () => {
    for (const status of ["initializing", "idle", "running", "error", "closed"] as const) {
      expect(tabAttentionStatus(chatTab(), status, true)).toBeNull();
    }
  });

  it("returns null when the session hasn't landed in the store yet (offline restore gap)", () => {
    expect(() => tabAttentionStatus(chatTab(), undefined, false)).not.toThrow();
    expect(tabAttentionStatus(chatTab(), undefined, false)).toBeNull();
  });

  it("maps every protocol status for an inactive chat tab", () => {
    expect(tabAttentionStatus(chatTab(), "running", false)).toBe("running");
    expect(tabAttentionStatus(chatTab(), "error", false)).toBe("error");
    expect(tabAttentionStatus(chatTab(), "idle", false)).toBeNull();
    expect(tabAttentionStatus(chatTab(), "initializing", false)).toBeNull();
    expect(tabAttentionStatus(chatTab(), "closed", false)).toBeNull();
  });
});
