import { describe, expect, it } from "vitest";
import {
  AT_BOTTOM_THRESHOLD_PX,
  isLaidOut,
  lastRowUserId,
  nextAnchorState,
  type ViewportMetrics,
} from "./bottom-anchor.js";
import type { TimelineRow } from "./row-model.js";

/** A laid-out viewport whose content sits `distance` px above the bottom. */
function viewport(distance: number): ViewportMetrics {
  return { scrollTop: 9400 - distance, scrollHeight: 10000, clientHeight: 600 };
}

/** A chat tab parked under `display:none`: every metric collapses to 0. */
const HIDDEN: ViewportMetrics = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };

describe("nextAnchorState — detaching", () => {
  it("detaches when a user gesture scrolls further than the threshold", () => {
    expect(
      nextAnchorState(
        true,
        { kind: "scroll", gesture: true },
        viewport(AT_BOTTOM_THRESHOLD_PX + 1),
      ),
    ).toEqual({ pinned: false, stick: false });
  });

  it("stays pinned when a gesture scrolls but stops within the threshold", () => {
    expect(
      nextAnchorState(true, { kind: "scroll", gesture: true }, viewport(AT_BOTTOM_THRESHOLD_PX)),
    ).toEqual({ pinned: true, stick: false });
  });

  it("never detaches on a scroll no gesture produced, however far from the bottom", () => {
    // A virtualizer re-measure correction, or the offset a hidden tab restores when shown again:
    // this is the failure that used to kill following mid-turn with no user input at all.
    expect(nextAnchorState(true, { kind: "scroll", gesture: false }, viewport(4000))).toEqual({
      pinned: true,
      stick: false,
    });
  });
});

describe("nextAnchorState — re-attaching", () => {
  it("re-attaches as soon as any scroll lands within the threshold", () => {
    expect(nextAnchorState(false, { kind: "scroll", gesture: true }, viewport(0))).toEqual({
      pinned: true,
      stick: false,
    });
  });

  it("stays detached while a gesture keeps the view away from the bottom", () => {
    expect(nextAnchorState(false, { kind: "scroll", gesture: true }, viewport(500))).toEqual({
      pinned: false,
      stick: false,
    });
  });
});

describe("nextAnchorState — following new content", () => {
  it("follows the tail while pinned", () => {
    expect(nextAnchorState(true, { kind: "tail" }, viewport(0))).toEqual({
      pinned: true,
      stick: true,
    });
  });

  it("leaves a detached reader alone when rows are appended", () => {
    expect(nextAnchorState(false, { kind: "tail" }, viewport(500))).toEqual({
      pinned: false,
      stick: false,
    });
  });
});

describe("nextAnchorState — hidden viewport", () => {
  it("holds pinned state across a scroll event with no layout box", () => {
    expect(nextAnchorState(true, { kind: "scroll", gesture: true }, HIDDEN)).toEqual({
      pinned: true,
      stick: false,
    });
    expect(nextAnchorState(false, { kind: "scroll", gesture: true }, HIDDEN)).toEqual({
      pinned: false,
      stick: false,
    });
  });

  it("never asks for a scroll that the browser would ignore", () => {
    expect(nextAnchorState(true, { kind: "tail" }, HIDDEN).stick).toBe(false);
    expect(nextAnchorState(true, { kind: "pin" }, HIDDEN).stick).toBe(false);
  });

  it("still records an explicit pin request made while hidden", () => {
    expect(nextAnchorState(false, { kind: "pin" }, HIDDEN).pinned).toBe(true);
  });

  it("re-asserts the bottom when the viewport becomes measurable again", () => {
    expect(nextAnchorState(true, { kind: "shown" }, viewport(4000))).toEqual({
      pinned: true,
      stick: true,
    });
    expect(nextAnchorState(false, { kind: "shown" }, viewport(4000))).toEqual({
      pinned: false,
      stick: false,
    });
  });
});

describe("nextAnchorState — explicit pin requests", () => {
  it("pulls a detached reader back to the bottom (jump-to-latest, own message)", () => {
    expect(nextAnchorState(false, { kind: "pin" }, viewport(4000))).toEqual({
      pinned: true,
      stick: true,
    });
  });
});

describe("isLaidOut", () => {
  it("is false for a collapsed viewport and true for a real one", () => {
    expect(isLaidOut(HIDDEN)).toBe(false);
    expect(isLaidOut(viewport(0))).toBe(true);
  });
});

describe("lastRowUserId", () => {
  const user: TimelineRow = { kind: "user", id: "u1", text: "hi" };
  const assistant: TimelineRow = { kind: "assistant", id: "a1", text: "yo", streaming: false };

  it("reports the id of a trailing user row", () => {
    expect(lastRowUserId([assistant, user])).toBe("u1");
  });

  it("reports null once the agent has answered", () => {
    expect(lastRowUserId([user, assistant])).toBeNull();
  });

  it("reports null for an empty timeline", () => {
    expect(lastRowUserId([])).toBeNull();
  });
});
