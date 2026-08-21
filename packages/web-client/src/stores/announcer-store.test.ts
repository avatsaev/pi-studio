import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANNOUNCE_CLEAR_DELAY_MS,
  clearWhenIdle,
  resetAnnouncerStoreForTests,
  speak,
  useAnnouncerStore,
} from "./announcer-store.js";

beforeEach(() => {
  vi.useFakeTimers();
  resetAnnouncerStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("speak", () => {
  it("sets the message and politeness", () => {
    speak("Answered in skill: connectivity");
    expect(useAnnouncerStore.getState()).toEqual({
      message: "Answered in skill: connectivity",
      politeness: "polite",
    });
  });

  it("defaults politeness to polite", () => {
    speak("hello");
    expect(useAnnouncerStore.getState().politeness).toBe("polite");
  });

  it("carries an explicit assertive politeness", () => {
    speak("Rate limit approaching.", "assertive");
    expect(useAnnouncerStore.getState().politeness).toBe("assertive");
  });

  it("a later speak overwrites an earlier one immediately", () => {
    speak("first");
    speak("second");
    expect(useAnnouncerStore.getState().message).toBe("second");
  });

  it("pre-empts a scheduled clear — a fresh announcement is never wiped by a stale timer", () => {
    speak("Answered in skill: connectivity");
    clearWhenIdle();
    vi.advanceTimersByTime(ANNOUNCE_CLEAR_DELAY_MS - 1);
    speak("A question needs input: retry the DNS lookups?");
    vi.advanceTimersByTime(10_000);
    expect(useAnnouncerStore.getState().message).toBe(
      "A question needs input: retry the DNS lookups?",
    );
  });
});

describe("clearWhenIdle", () => {
  it("does not clear immediately", () => {
    speak("Answered in skill: connectivity");
    clearWhenIdle();
    expect(useAnnouncerStore.getState().message).toBe("Answered in skill: connectivity");
  });

  it("clears the message after the announce delay", () => {
    speak("Answered in skill: connectivity");
    clearWhenIdle();
    vi.advanceTimersByTime(ANNOUNCE_CLEAR_DELAY_MS);
    expect(useAnnouncerStore.getState().message).toBe("");
  });

  it("a second clearWhenIdle call restarts the delay rather than stacking timers", () => {
    speak("Answered in skill: connectivity");
    clearWhenIdle();
    vi.advanceTimersByTime(ANNOUNCE_CLEAR_DELAY_MS - 1);
    clearWhenIdle();
    vi.advanceTimersByTime(ANNOUNCE_CLEAR_DELAY_MS - 1);
    // The first timer would have fired by now had it not been cancelled by the second call.
    expect(useAnnouncerStore.getState().message).toBe("Answered in skill: connectivity");
    vi.advanceTimersByTime(1);
    expect(useAnnouncerStore.getState().message).toBe("");
  });
});

describe("resetAnnouncerStoreForTests", () => {
  it("resets to initial state and cancels a pending clear", () => {
    speak("Answered in skill: connectivity");
    clearWhenIdle();
    resetAnnouncerStoreForTests();
    expect(useAnnouncerStore.getState()).toEqual({ message: "", politeness: "polite" });
    vi.advanceTimersByTime(ANNOUNCE_CLEAR_DELAY_MS);
    // The cancelled timer must not resurrect a later, unrelated test's message.
    speak("unrelated later message");
    vi.advanceTimersByTime(ANNOUNCE_CLEAR_DELAY_MS);
    expect(useAnnouncerStore.getState().message).toBe("unrelated later message");
  });
});
