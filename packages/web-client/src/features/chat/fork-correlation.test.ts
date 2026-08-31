import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@pi-studio-ui/timeline/row-model.js";
import {
  buildConfirmedOrdinalByRowId,
  collectConfirmedUserRows,
  correlateForkTarget,
  isConfirmedUserRow,
} from "./fork-correlation.js";

function userRow(overrides: Partial<TimelineRow> & { id: string; text: string }): TimelineRow {
  return { kind: "user", ...overrides } as TimelineRow;
}

describe("isConfirmedUserRow", () => {
  it("is true for a plain user row with no pending/failed flags", () => {
    expect(isConfirmedUserRow(userRow({ id: "r1", text: "hi" }))).toBe(true);
  });

  it("is false for a pending optimistic row", () => {
    expect(isConfirmedUserRow(userRow({ id: "r1", text: "hi", pending: true }))).toBe(false);
  });

  it("is false for a failed row", () => {
    expect(isConfirmedUserRow(userRow({ id: "r1", text: "hi", failed: true }))).toBe(false);
  });

  it("is false for a non-user row", () => {
    const row = { kind: "assistant", id: "a1", text: "hi" } as unknown as TimelineRow;
    expect(isConfirmedUserRow(row)).toBe(false);
  });
});

describe("collectConfirmedUserRows / buildConfirmedOrdinalByRowId", () => {
  const rows: TimelineRow[] = [
    userRow({ id: "u1", text: "first" }),
    { kind: "assistant", id: "a1" } as unknown as TimelineRow,
    userRow({ id: "u2", text: "second", pending: true }),
    userRow({ id: "u3", text: "second (confirmed)", failed: true }),
    userRow({ id: "u4", text: "third" }),
  ];

  it("collects only confirmed user row texts, in transcript order", () => {
    expect(collectConfirmedUserRows(rows)).toEqual(["first", "third"]);
  });

  it("maps only confirmed rows to their ordinal, skipping pending/failed/non-user rows", () => {
    const map = buildConfirmedOrdinalByRowId(rows);
    expect(map.get("u1")).toBe(0);
    expect(map.get("u4")).toBe(1);
    expect(map.has("u2")).toBe(false);
    expect(map.has("u3")).toBe(false);
    expect(map.has("a1")).toBe(false);
  });
});

describe("correlateForkTarget", () => {
  const texts = ["fix the bug", "add a test"];

  it("matches when the ordinal is in range and the text agrees exactly", () => {
    const messages = [
      { entryId: "e1", text: "fix the bug" },
      { entryId: "e2", text: "add a test" },
    ];
    expect(correlateForkTarget(texts, 1, messages)).toEqual({
      outcome: "matched",
      target: { entryId: "e2", text: "add a test" },
    });
  });

  it("still matches through a whitespace-only difference", () => {
    const messages = [{ entryId: "e1", text: "  fix   the\nbug  " }];
    expect(correlateForkTarget(["fix the bug"], 0, messages)).toEqual({
      outcome: "matched",
      target: { entryId: "e1", text: "  fix   the\nbug  " },
    });
  });

  it("falls back to the picker when the ordinal is out of range", () => {
    const messages = [{ entryId: "e1", text: "fix the bug" }];
    expect(correlateForkTarget(texts, 5, messages)).toEqual({ outcome: "fallback-to-picker" });
  });

  it("falls back to the picker when there are fewer forkMessages() entries than the ordinal", () => {
    expect(correlateForkTarget(texts, 1, [{ entryId: "e1", text: "fix the bug" }])).toEqual({
      outcome: "fallback-to-picker",
    });
  });

  it("falls back to the picker on a real text mismatch", () => {
    const messages = [{ entryId: "e1", text: "totally different text" }];
    expect(correlateForkTarget(["fix the bug"], 0, messages)).toEqual({
      outcome: "fallback-to-picker",
    });
  });
});
