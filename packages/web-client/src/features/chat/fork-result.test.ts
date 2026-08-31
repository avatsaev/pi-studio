import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyForkError,
  applyForkSuccess,
  FORK_DECLINED_TOAST,
  FORK_GENERIC_ERROR_TOAST,
} from "./fork-result.js";
import { useDraftStore } from "@pi-studio-ui/stores/draft-store.js";
import { useForkStore } from "@pi-studio-ui/stores/fork-store.js";
import { useSessionStore, type SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { resetToastStoreForTests, useToastStore } from "@pi-studio-ui/stores/toast-store.js";
import { EMPTY_TIMELINE } from "@pi-studio-ui/timeline/reducer.js";

function session(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: "s1",
    agentId: "a1",
    title: "New chat",
    status: "idle",
    cwd: "/tmp",
    timeline: EMPTY_TIMELINE,
    userMessageCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
  useDraftStore.setState({ drafts: {}, pendingFeedback: {} });
  useForkStore.setState({ dialog: { status: "closed" } });
  resetToastStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("applyForkSuccess — cancelled", () => {
  it("toasts the § 12 declined copy and closes the dialog, touching nothing else", () => {
    useSessionStore.getState().hydrate(session());
    useForkStore.getState().openConfirm("a1", { entryId: "e1", text: "hi" }, null);
    applyForkSuccess("a1", { text: "hi", cancelled: true });

    expect(useForkStore.getState().dialog).toEqual({ status: "closed" });
    expect(useToastStore.getState().toasts.map((t) => t.content)).toEqual([FORK_DECLINED_TOAST]);
    expect(useDraftStore.getState().drafts["s1"]).toBeUndefined();
  });
});

describe("applyForkSuccess — success", () => {
  it("closes the dialog and prefills an empty draft with the returned text", () => {
    useSessionStore.getState().hydrate(session());
    useForkStore.getState().openConfirm("a1", { entryId: "e1", text: "hi" }, null);
    applyForkSuccess("a1", { text: "original prompt", cancelled: false });

    expect(useForkStore.getState().dialog).toEqual({ status: "closed" });
    expect(useDraftStore.getState().drafts["s1"]).toBe("original prompt");
  });

  it("leaves a non-empty draft untouched and shows no warning", () => {
    useSessionStore.getState().hydrate(session());
    useDraftStore.getState().setDraft("s1", "my in-progress draft");
    applyForkSuccess("a1", { text: "original prompt", cancelled: false });

    expect(useDraftStore.getState().drafts["s1"]).toBe("my in-progress draft");
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("targets the forked session's own draft even when another session's composer is focused", () => {
    useSessionStore.getState().hydrate(session({ id: "s1", agentId: "a1" }));
    useSessionStore.getState().hydrate(session({ id: "s2", agentId: "a2" }));
    useSessionStore.getState().activate("s2"); // a different session is "in view"/focused
    applyForkSuccess("a1", { text: "original prompt", cancelled: false });

    expect(useDraftStore.getState().drafts["s1"]).toBe("original prompt");
    expect(useDraftStore.getState().drafts["s2"]).toBeUndefined();
  });

  it("is a no-op prefill when no session is known for the agent (the tab is gone)", () => {
    expect(() => applyForkSuccess("unknown-agent", { text: "x", cancelled: false })).not.toThrow();
    expect(useDraftStore.getState().drafts).toEqual({});
  });
});

describe("applyForkError", () => {
  it("toasts the daemon's error message and returns the dialog to a reusable idle state", () => {
    useForkStore.getState().openConfirm("a1", { entryId: "e1", text: "hi" }, null);
    useForkStore.getState().setPending(true);

    applyForkError(new Error("This session has not been saved yet. Send a message first."));

    expect(useForkStore.getState().dialog).toEqual({
      status: "confirm",
      agentId: "a1",
      target: { entryId: "e1", text: "hi" },
      pending: false,
      backTo: null,
      triggerElement: null,
    });
    expect(useToastStore.getState().toasts.map((t) => t.content)).toEqual([
      "This session has not been saved yet. Send a message first.",
    ]);
  });

  it("falls back to the generic § 12 copy when the error carries no message", () => {
    applyForkError("not an Error instance");
    expect(useToastStore.getState().toasts.map((t) => t.content)).toEqual([
      FORK_GENERIC_ERROR_TOAST,
    ]);
  });

  it("never closes the dialog — a retry needs no reopening", () => {
    useForkStore.getState().openPicker("a1", [{ entryId: "e1", text: "hi" }], null);
    applyForkError(new Error("boom"));
    expect(useForkStore.getState().dialog.status).toBe("picker");
  });
});
