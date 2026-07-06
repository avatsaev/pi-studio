import { describe, expect, it } from "vitest";
import {
  isRewindPending,
  postRewindActions,
  REWIND_IDLE,
  rewindError,
  rewindMenuItems,
  rewindSuccess,
  shouldShowRewindMenu,
  startRewind,
  buildRewindRequest,
  buildRewindConfirmation,
  REWIND_RPC,
} from "./index.js";

describe("rewind RPC + confirmation", () => {
  it("builds the rewind request payload", () => {
    expect(buildRewindRequest("a1", "m3", "both")).toEqual({ agentId: "a1", messageId: "m3", mode: "both" });
    expect(REWIND_RPC).toBe("agent.rewind.request");
  });

  it("conversation mode needs no destructive confirmation", () => {
    const c = buildRewindConfirmation("conversation");
    expect(c.required).toBe(false);
    expect(c.destructive).toBe(false);
    expect(c.affectedFiles).toEqual([]);
  });

  it("files/both mode requires a destructive confirmation listing files", () => {
    const c = buildRewindConfirmation("files", ["a.ts", "b.ts"]);
    expect(c.required).toBe(true);
    expect(c.destructive).toBe(true);
    expect(c.affectedFiles).toEqual(["a.ts", "b.ts"]);
    expect(c.message).toContain("2 files will be reverted");
    expect(buildRewindConfirmation("both").title).toBe("Rewind conversation & files");
  });

  it("falls back to a generic file clause when no files are listed", () => {
    const c = buildRewindConfirmation("both", []);
    expect(c.message).toContain("Workspace file changes");
  });
});

describe("rewind menu", () => {
  it("returns empty for provider with no rewind capability", () => {
    expect(rewindMenuItems({ supportsStreaming: true, supportsSessionPersistence: false, supportsDynamicModes: false, supportsMcpServers: false, supportsReasoningStream: false, supportsToolInvocations: false })).toEqual([]);
    expect(shouldShowRewindMenu({})).toBe(false);
  });

  it("includes only the modes the provider supports", () => {
    const items = rewindMenuItems({ supportsRewindConversation: true });
    expect(items).toHaveLength(1);
    expect(items[0]!.mode).toBe("conversation");
  });

  it("includes all three modes when fully supported", () => {
    const items = rewindMenuItems({ supportsRewindConversation: true, supportsRewindFiles: true, supportsRewindBoth: true });
    expect(items.map((i) => i.mode)).toEqual(["conversation", "files", "both"]);
    expect(shouldShowRewindMenu({ supportsRewindBoth: true })).toBe(true);
  });
});

describe("rewind mutation state machine", () => {
  it("starts idle and transitions to pending", () => {
    expect(REWIND_IDLE.status).toBe("idle");
    const pending = startRewind("msg-1", "conversation");
    expect(pending.status).toBe("pending");
    expect(isRewindPending(pending)).toBe(true);
  });

  it("resolves to idle on success", () => {
    const state = rewindSuccess(startRewind("msg-1", "both"));
    expect(state.status).toBe("idle");
    expect(isRewindPending(state)).toBe(false);
  });

  it("sets error state on failure and keeps menu usable (not closed)", () => {
    const state = rewindError(startRewind("msg-1", "files"), "Server error");
    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.error).toBe("Server error");
  });
});

describe("post-rewind client actions", () => {
  it("conversation rewind triggers refetch-tail", () => {
    const actions = postRewindActions({ mode: "conversation", agentId: "a1", rewoundMessageText: "hello", composerEmpty: true });
    expect(actions.some((a) => a.kind === "refetch-tail")).toBe(true);
  });

  it("restores composer text only when composer is empty", () => {
    const filled = postRewindActions({ mode: "conversation", agentId: "a1", rewoundMessageText: "hello", composerEmpty: false });
    expect(filled.some((a) => a.kind === "restore-composer")).toBe(false);
    const empty = postRewindActions({ mode: "conversation", agentId: "a1", rewoundMessageText: "hello", composerEmpty: true });
    expect(empty.some((a) => a.kind === "restore-composer")).toBe(true);
  });

  it("files-only rewind returns noop (no conversation change)", () => {
    const actions = postRewindActions({ mode: "files", agentId: "a1", rewoundMessageText: "hi", composerEmpty: true });
    expect(actions[0]?.kind).toBe("noop");
  });

  it("both mode triggers refetch AND potentially restore", () => {
    const actions = postRewindActions({ mode: "both", agentId: "a1", rewoundMessageText: "x", composerEmpty: true });
    expect(actions.some((a) => a.kind === "refetch-tail")).toBe(true);
    expect(actions.some((a) => a.kind === "restore-composer")).toBe(true);
  });
});
