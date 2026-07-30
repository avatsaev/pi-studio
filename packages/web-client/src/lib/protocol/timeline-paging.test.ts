import { describe, expect, it } from "vitest";
import { fetchTimelineEvents, type TimelinePageLike } from "./timeline-paging.js";

/** One "other" projected item carrying a user_message event, as the daemon returns it. */
function userItem(text: string): unknown {
  return { kind: "other", event: { kind: "user_message", messageId: text, text } };
}

/** Build a fetch stub over fixed pages, recording the cursor each call received. */
function pager(pages: TimelinePageLike[]): {
  fetchPage: (cursor: string | null) => Promise<TimelinePageLike>;
  cursors: (string | null)[];
} {
  const cursors: (string | null)[] = [];
  let i = 0;
  return {
    cursors,
    fetchPage: (cursor) => {
      cursors.push(cursor);
      return Promise.resolve(pages[i++] ?? { items: [], hasNewer: false });
    },
  };
}

describe("fetchTimelineEvents", () => {
  it("returns a single page's events without asking for more", async () => {
    const { fetchPage, cursors } = pager([
      { items: [userItem("a")], hasNewer: false, endCursor: "3" },
    ]);
    const events = await fetchTimelineEvents(fetchPage);
    expect(events).toEqual([{ kind: "user_message", messageId: "a", text: "a" }]);
    expect(cursors).toEqual([null]);
  });

  it("pages to completion, resuming from each page's endCursor in order", async () => {
    const { fetchPage, cursors } = pager([
      { items: [userItem("a")], hasNewer: true, endCursor: "199" },
      { items: [userItem("b")], hasNewer: true, endCursor: "399" },
      { items: [userItem("c")], hasNewer: false, endCursor: "485" },
    ]);
    const events = await fetchTimelineEvents(fetchPage);
    expect(events.map((e) => (e.kind === "user_message" ? e.text : e.kind))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(cursors).toEqual([null, "199", "399"]);
  });

  it("stops on an empty page even when the daemon still claims newer rows", async () => {
    const { fetchPage, cursors } = pager([
      { items: [userItem("a")], hasNewer: true, endCursor: "199" },
      { items: [], hasNewer: true, endCursor: "199" },
    ]);
    const events = await fetchTimelineEvents(fetchPage);
    expect(events).toHaveLength(1);
    expect(cursors).toEqual([null, "199"]);
  });

  it("stops when the cursor fails to advance (never loops on a stuck page)", async () => {
    let calls = 0;
    const events = await fetchTimelineEvents(() => {
      calls++;
      return Promise.resolve({ items: [userItem("a")], hasNewer: true, endCursor: "199" });
    });
    expect(calls).toBe(2);
    expect(events).toHaveLength(2);
  });

  it("stops when a page claiming newer rows carries no cursor to resume from", async () => {
    const { fetchPage, cursors } = pager([
      { items: [userItem("a")], hasNewer: true, endCursor: null },
    ]);
    const events = await fetchTimelineEvents(fetchPage);
    expect(events).toHaveLength(1);
    expect(cursors).toEqual([null]);
  });

  it("propagates a fetch failure so the caller can fall back to an empty timeline", async () => {
    await expect(fetchTimelineEvents(() => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
  });
});
