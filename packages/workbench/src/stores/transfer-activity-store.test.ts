import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAbortError, useTransferActivityStore } from "./transfer-activity-store.js";
import { activityText, percentOf } from "./transfer-activity-text.js";

const store = () => useTransferActivityStore.getState();

beforeEach(() => {
  useTransferActivityStore.setState({ activities: [], lastResult: null });
});

describe("activityText", () => {
  it("shows the label and the percentage of a running activity", () => {
    expect(activityText({ label: "Uploading 3 files", percent: 42, state: "running" })).toBe(
      "Uploading 3 files… 42%",
    );
    expect(activityText({ label: "Downloading report.pdf", percent: 0, state: "running" })).toBe(
      "Downloading report.pdf… 0%",
    );
  });

  it("shows no percentage when a size is unknown", () => {
    expect(activityText({ label: "Uploading 1 file", percent: null, state: "running" })).toBe(
      "Uploading 1 file…",
    );
  });

  it("replaces the percentage with the state's words", () => {
    expect(activityText({ label: "Downloading a.bin", percent: 60, state: "waiting" })).toBe(
      "Downloading a.bin… waiting for the connection",
    );
    expect(activityText({ label: "Downloading a.bin", percent: 60, state: "queued" })).toBe(
      "Downloading a.bin… waiting",
    );
    expect(activityText({ label: "Downloading a.bin", percent: null, state: "queued" })).toBe(
      "Downloading a.bin… waiting",
    );
  });
});

describe("percentOf", () => {
  it("floors to a whole percent and caps at 100", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(5, 4)).toBe(100);
    expect(percentOf(0, 10)).toBe(0);
  });

  it("is null for an unknown or empty size", () => {
    expect(percentOf(5, undefined)).toBeNull();
    expect(percentOf(0, 0)).toBeNull();
  });
});

describe("isAbortError", () => {
  it("tells a cancel from a failure", () => {
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(true);
    expect(isAbortError(new Error("x"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});

describe("transfer activity store", () => {
  it("adds activities oldest first, each with its own cancel", () => {
    const cancelA = vi.fn();
    const cancelB = vi.fn();
    const cancelC = vi.fn();
    const a = store().add({ kind: "save", label: "Downloading a", cancel: cancelA });
    const b = store().add({ kind: "upload", label: "Uploading 2 files", cancel: cancelB });
    const c = store().add({ kind: "save", label: "Downloading c", cancel: cancelC });

    const { activities } = store();
    expect(activities.map((x) => x.id)).toEqual([a, b, c]);
    expect(new Set([a, b, c]).size).toBe(3);
    activities[1]?.cancel();
    expect(cancelB).toHaveBeenCalledOnce();
    expect(cancelA).not.toHaveBeenCalled();
    expect(cancelC).not.toHaveBeenCalled();
  });

  it("starts running with no percentage", () => {
    store().add({ kind: "save", label: "x", cancel: () => {} });
    expect(store().activities[0]).toMatchObject({ percent: null, state: "running" });
  });

  it("updates one activity and leaves the others", () => {
    const a = store().add({ kind: "save", label: "a", cancel: () => {} });
    const b = store().add({ kind: "save", label: "b", cancel: () => {} });
    store().update(a, { percent: 50 });
    store().update(b, { state: "waiting" });
    expect(store().activities.map((x) => [x.percent, x.state])).toEqual([
      [50, "running"],
      [null, "waiting"],
    ]);
  });

  it("keeps the same state object when an update changes nothing", () => {
    const id = store().add({ kind: "save", label: "a", cancel: () => {} });
    store().update(id, { percent: 10, state: "running" });
    const before = store();
    store().update(id, { percent: 10 });
    store().update(id, { state: "running" });
    store().update("missing", { percent: 99 });
    expect(store()).toBe(before);
  });

  it("can clear a percentage back to null", () => {
    const id = store().add({ kind: "save", label: "a", cancel: () => {}, percent: 5 });
    store().update(id, { percent: null });
    expect(store().activities[0]?.percent).toBeNull();
  });

  it("removes an activity and records its outcome as the last result", () => {
    const a = store().add({ kind: "save", label: "a", cancel: () => {} });
    const b = store().add({ kind: "save", label: "b", cancel: () => {} });
    store().remove(a, { text: "Downloaded a", error: false });
    expect(store().activities.map((x) => x.id)).toEqual([b]);
    expect(store().lastResult).toMatchObject({ text: "Downloaded a", error: false });
  });

  it("removing without an outcome keeps the last result", () => {
    const a = store().add({ kind: "save", label: "a", cancel: () => {} });
    store().report({ text: "Upload failed: x", error: true });
    store().remove(a);
    expect(store().activities).toEqual([]);
    expect(store().lastResult?.text).toBe("Upload failed: x");
  });

  it("gives a repeated text a new sequence number, and clears only the current one", () => {
    store().report({ text: "Upload cancelled", error: false });
    const first = store().lastResult?.seq ?? 0;
    store().report({ text: "Upload cancelled", error: false });
    const second = store().lastResult?.seq ?? 0;
    expect(second).toBeGreaterThan(first);
    store().clearResult(first);
    expect(store().lastResult?.seq).toBe(second);
    store().clearResult(second);
    expect(store().lastResult).toBeNull();
  });
});
