import { describe, expect, it } from "vitest";

import {
  parseCollapsed,
  serializeCollapsed,
  TODO_COLLAPSE_MAX_ENTRIES,
} from "./todo-collapse-codec.js";

describe("todo collapse codec", () => {
  it("round-trips", () => {
    expect(parseCollapsed(serializeCollapsed(new Set(["a", "b"])))).toEqual(new Set(["a", "b"]));
  });

  it("degrades to empty on null, corrupt JSON, a wrong version or a non-string entry", () => {
    for (const raw of [
      null,
      "",
      "{nope",
      "[]",
      '{"version":2,"collapsed":["a"]}',
      '{"version":1,"collapsed":["a",1]}',
      '{"version":1}',
    ]) {
      expect(parseCollapsed(raw).size).toBe(0);
    }
  });

  it("evicts the oldest id past the cap", () => {
    const ids = new Set(Array.from({ length: TODO_COLLAPSE_MAX_ENTRIES + 1 }, (_, i) => `a${i}`));
    const back = parseCollapsed(serializeCollapsed(ids));
    expect(back.size).toBe(TODO_COLLAPSE_MAX_ENTRIES);
    expect(back.has("a0")).toBe(false);
    expect(back.has(`a${TODO_COLLAPSE_MAX_ENTRIES}`)).toBe(true);
  });
});
