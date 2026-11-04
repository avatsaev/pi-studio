import { describe, expect, it } from "vitest";
import {
  decideComposerDrop,
  formatRefToken,
  planInsertion,
  refRoot,
  relativeRefPath,
  type ComposerDropInput,
} from "./composer-path-drop.js";

describe("refRoot", () => {
  it("is null for a tilde root with no homeDir", () => {
    expect(refRoot("~", null)).toBeNull();
    expect(refRoot("~/p", null)).toBeNull();
  });

  it("expands ~ against homeDir", () => {
    expect(refRoot("~/p", "/h")).toBe("/h/p");
    expect(refRoot("~", "/h")).toBe("/h");
  });

  it("strips a trailing slash", () => {
    expect(refRoot("/repo/", null)).toBe("/repo");
    expect(refRoot("/repo", null)).toBe("/repo");
  });

  it("falls back to ~ for an empty cwd", () => {
    expect(refRoot("", "/h")).toBe("/h");
    expect(refRoot("", null)).toBeNull();
  });
});

describe("relativeRefPath", () => {
  it("makes a path inside the root relative", () => {
    expect(relativeRefPath("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
  });

  it("keeps a folder's trailing slash", () => {
    expect(relativeRefPath("/repo/src/", "/repo")).toBe("src/");
  });

  it("rejects a sibling that merely shares the prefix", () => {
    expect(relativeRefPath("/repo2/x", "/repo")).toBeNull();
    expect(relativeRefPath("/repo2/", "/repo")).toBeNull();
  });

  it("rejects the root itself, with and without a slash", () => {
    expect(relativeRefPath("/repo", "/repo")).toBeNull();
    expect(relativeRefPath("/repo/", "/repo")).toBeNull();
  });

  it("rejects paths outside the root", () => {
    expect(relativeRefPath("/other/a.ts", "/repo")).toBeNull();
  });

  it("rejects a null, empty or tilde root", () => {
    expect(relativeRefPath("/repo/a.ts", null)).toBeNull();
    expect(relativeRefPath("/repo/a.ts", "")).toBeNull();
    expect(relativeRefPath("~/a.ts", "~")).toBeNull();
  });
});

describe("formatRefToken", () => {
  it("leaves an ordinary path bare", () => {
    expect(formatRefToken("src/a.ts")).toBe("src/a.ts");
    expect(formatRefToken("src/")).toBe("src/");
  });

  it("wraps a path with a space", () => {
    expect(formatRefToken("my docs/a.md")).toBe("`my docs/a.md`");
  });

  it("wraps a path with a tab or newline", () => {
    expect(formatRefToken("a\tb")).toBe("`a\tb`");
    expect(formatRefToken("a\nb")).toBe("`a\nb`");
  });

  it("uses a longer fence around an inner backtick", () => {
    expect(formatRefToken("a`b")).toBe("``a`b``");
    expect(formatRefToken("a``b c")).toBe("```a``b c```");
  });

  it("pads when the path starts or ends with a backtick", () => {
    expect(formatRefToken("`a")).toBe("`` `a ``");
    expect(formatRefToken("a`")).toBe("`` a` ``");
    expect(formatRefToken("`a`")).toBe("`` `a` ``");
  });
});

describe("planInsertion", () => {
  it("adds only a trailing space to an empty draft", () => {
    expect(planInsertion("", 0, 0, "a.ts")).toEqual({
      start: 0,
      end: 0,
      insert: "a.ts ",
      caret: 5,
    });
  });

  it("adds a leading space when glued after a word", () => {
    const plan = planInsertion("see", 3, 3, "a.ts");
    expect(plan.insert).toBe(" a.ts ");
    expect(plan.caret).toBe(3 + 6);
  });

  it("adds no trailing space before existing whitespace", () => {
    expect(planInsertion("see  now", 3, 3, "a.ts").insert).toBe(" a.ts");
    expect(planInsertion("see\nnow", 3, 3, "a.ts").insert).toBe(" a.ts");
  });

  it("adds no leading space at the start of a line or after a space", () => {
    expect(planInsertion("one\ntwo", 4, 4, "a.ts").insert).toBe("a.ts ");
    expect(planInsertion("one ", 4, 4, "a.ts").insert).toBe("a.ts ");
  });

  it("still adds a trailing space when glued before a word", () => {
    expect(planInsertion("see now", 0, 0, "a.ts").insert).toBe("a.ts ");
  });

  it("replaces a selection and judges spacing outside it", () => {
    const text = "fix BAD now";
    const plan = planInsertion(text, 4, 7, "a.ts");
    expect(plan).toEqual({ start: 4, end: 7, insert: "a.ts", caret: 8 });
    const glued = planInsertion("fixBADnow", 3, 6, "a.ts");
    expect(glued.insert).toBe(" a.ts ");
  });

  it("clamps out-of-range and reversed offsets", () => {
    expect(planInsertion("abc", 99, 99, "x")).toMatchObject({ start: 3, end: 3 });
    expect(planInsertion("abc", -5, -1, "x")).toMatchObject({ start: 0, end: 0 });
    expect(planInsertion("abc def", 5, 2, "x")).toMatchObject({ start: 2, end: 5 });
  });
});

describe("decideComposerDrop", () => {
  const base: ComposerDropInput = {
    refValue: "/repo/src/a.ts",
    compacting: false,
    root: "/repo",
    text: "",
    selStart: 0,
    selEnd: 0,
    neverFocused: false,
  };
  const insertOf = (over: Partial<ComposerDropInput>) => {
    const d = decideComposerDrop({ ...base, ...over });
    if (d.kind !== "insert") throw new Error(`expected insert, got ${d.kind}`);
    return d.plan;
  };

  it("ignores a drag with no usable ref", () => {
    expect(decideComposerDrop({ ...base, refValue: null })).toEqual({ kind: "ignore" });
  });

  it("ignores everything while compacting", () => {
    expect(decideComposerDrop({ ...base, compacting: true })).toEqual({ kind: "ignore" });
    expect(decideComposerDrop({ ...base, compacting: true, root: null })).toEqual({
      kind: "ignore",
    });
  });

  it("refuses an unresolvable or outside root", () => {
    expect(decideComposerDrop({ ...base, root: null })).toEqual({ kind: "refuse" });
    expect(decideComposerDrop({ ...base, refValue: "/other/a.ts" })).toEqual({ kind: "refuse" });
    expect(decideComposerDrop({ ...base, refValue: "/repo2/a.ts" })).toEqual({ kind: "refuse" });
  });

  it("inserts into an empty draft with a trailing space", () => {
    expect(insertOf({})).toEqual({ start: 0, end: 0, insert: "src/a.ts ", caret: 9 });
  });

  it("replaces a selection", () => {
    const plan = insertOf({ text: "fix BAD now", selStart: 4, selEnd: 7 });
    expect(plan).toMatchObject({ start: 4, end: 7, insert: "src/a.ts" });
  });

  it("spaces a path glued to a word", () => {
    expect(insertOf({ text: "see", selStart: 3, selEnd: 3 }).insert).toBe(" src/a.ts ");
  });

  it("gives a folder its trailing slash and wraps a spaced name", () => {
    expect(insertOf({ refValue: "/repo/src/" }).insert).toBe("src/ ");
    expect(insertOf({ refValue: "/repo/my docs/a.md" }).insert).toBe("`my docs/a.md` ");
  });

  it("inserts at the end, ignoring the caret, until the textarea has been focused", () => {
    const stale = { text: "seeded draft", selStart: 0, selEnd: 0 };
    expect(insertOf({ ...stale, neverFocused: true })).toMatchObject({ start: 12, end: 12 });
    expect(insertOf({ ...stale, neverFocused: false })).toMatchObject({ start: 0, end: 0 });
  });
});
