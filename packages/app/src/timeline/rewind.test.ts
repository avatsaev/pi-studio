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
} from "./index.js";

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
