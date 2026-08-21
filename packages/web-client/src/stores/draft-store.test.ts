import { beforeEach, describe, expect, it } from "vitest";
import { useDraftStore } from "./draft-store.js";

beforeEach(() => {
  useDraftStore.setState({ drafts: {}, pendingFeedback: {} });
});

describe("setDraft", () => {
  it("stores per-session text and never produces feedback", () => {
    useDraftStore.getState().setDraft("s1", "hello");
    expect(useDraftStore.getState().drafts.s1).toBe("hello");
    expect(useDraftStore.getState().pendingFeedback.s1).toBeUndefined();
  });

  it("a session with no entry reads as an empty draft", () => {
    expect(useDraftStore.getState().drafts.unknown).toBeUndefined();
  });

  it("two sessions' drafts never collide", () => {
    useDraftStore.getState().setDraft("s1", "for s1");
    useDraftStore.getState().setDraft("s2", "for s2");
    expect(useDraftStore.getState().drafts.s1).toBe("for s1");
    expect(useDraftStore.getState().drafts.s2).toBe("for s2");
  });
});

describe("replaceDraft — copy decision", () => {
  it("an empty prior draft produces 'filled'", () => {
    useDraftStore.getState().replaceDraft("s1", "new text", true);
    expect(useDraftStore.getState().pendingFeedback.s1).toEqual({ copy: "filled", flash: true });
  });

  it("a non-empty prior draft produces 'replaced'", () => {
    useDraftStore.getState().setDraft("s1", "half-finished sentence");
    useDraftStore.getState().replaceDraft("s1", "new text", true);
    expect(useDraftStore.getState().pendingFeedback.s1).toEqual({ copy: "replaced", flash: true });
  });

  it("an empty incoming text against a non-empty prior draft still reads as 'replaced', through the same standard treatment — no special case for clearing", () => {
    useDraftStore.getState().setDraft("s1", "half-finished sentence");
    useDraftStore.getState().replaceDraft("s1", "", true);
    expect(useDraftStore.getState().drafts.s1).toBe("");
    expect(useDraftStore.getState().pendingFeedback.s1).toEqual({ copy: "replaced", flash: true });
  });
});

describe("replaceDraft — flash vs deferred (§ 11 background-pane rule)", () => {
  it("visible=true flashes immediately", () => {
    useDraftStore.getState().replaceDraft("s1", "text", true);
    expect(useDraftStore.getState().pendingFeedback.s1?.flash).toBe(true);
  });

  it("visible=false queues note-only feedback — never flash for a background replacement", () => {
    useDraftStore.getState().replaceDraft("s1", "text", false);
    expect(useDraftStore.getState().pendingFeedback.s1?.flash).toBe(false);
  });

  it("the text still applies immediately even when not visible — never lost", () => {
    useDraftStore.getState().replaceDraft("s1", "arrived while backgrounded", false);
    expect(useDraftStore.getState().drafts.s1).toBe("arrived while backgrounded");
  });
});

describe("consumeFeedback", () => {
  it("returns the queued feedback once, then nothing on a second call", () => {
    useDraftStore.getState().replaceDraft("s1", "text", true);
    expect(useDraftStore.getState().consumeFeedback("s1")).toEqual({ copy: "filled", flash: true });
    expect(useDraftStore.getState().consumeFeedback("s1")).toBeUndefined();
  });

  it("returns undefined for a session with nothing queued", () => {
    expect(useDraftStore.getState().consumeFeedback("nothing-pending")).toBeUndefined();
  });

  it("consuming one session's feedback never touches a sibling session's queue", () => {
    useDraftStore.getState().replaceDraft("s1", "for s1", true);
    useDraftStore.getState().replaceDraft("s2", "for s2", false);
    useDraftStore.getState().consumeFeedback("s1");
    expect(useDraftStore.getState().pendingFeedback.s2).toEqual({ copy: "filled", flash: false });
  });
});
