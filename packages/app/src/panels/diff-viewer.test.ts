import { describe, it, expect } from "vitest";
import {
  computeWordDiff,
  tokenizeWords,
  buildUnifiedRows,
  buildSplitRows,
  diffPlaceholder,
  changeRowIndices,
  nextChangeIndex,
  prevChangeIndex,
  hunkToText,
  formatBytes,
  TOO_LARGE_BYTES,
  type DiffInput,
} from "./diff-viewer.js";

function modifiedDiff(): DiffInput {
  return {
    filePath: "src/a.ts",
    kind: "modified",
    hunks: [
      {
        header: "@@ -1,3 +1,3 @@",
        lines: [
          { kind: "context", content: "line one", oldLineNo: 1, newLineNo: 1 },
          { kind: "removed", content: "hello world", oldLineNo: 2 },
          { kind: "added", content: "hello earth", newLineNo: 2 },
          { kind: "context", content: "line three", oldLineNo: 3, newLineNo: 3 },
        ],
      },
    ],
  };
}

describe("computeWordDiff", () => {
  it("highlights only the changed word", () => {
    const wd = computeWordDiff("hello world", "hello earth");
    expect(wd.old).toEqual([
      { type: "equal", value: "hello " },
      { type: "remove", value: "world" },
    ]);
    expect(wd.new).toEqual([
      { type: "equal", value: "hello " },
      { type: "add", value: "earth" },
    ]);
  });

  it("tokenizes words, whitespace, and punctuation separately", () => {
    expect(tokenizeWords("a = b;")).toEqual(["a", " ", "=", " ", "b", ";"]);
  });
});

describe("buildUnifiedRows", () => {
  it("renders a hunk header, context, and word-annotated change lines", () => {
    const rows = buildUnifiedRows(modifiedDiff());
    expect(rows[0]).toMatchObject({ type: "hunk-header", header: "@@ -1,3 +1,3 @@" });
    const removed = rows.find((r) => r.type === "line" && r.kind === "removed");
    expect(removed).toMatchObject({ isChange: true, oldLineNo: 2 });
    // @ts-expect-error narrowed at runtime
    expect(removed.wordSegments).toEqual([
      { type: "equal", value: "hello " },
      { type: "remove", value: "world" },
    ]);
    const ctx = rows.filter((r) => r.type === "line" && r.kind === "context");
    expect(ctx).toHaveLength(2);
  });

  it("collapses long unchanged ranges into a single marker", () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({
      kind: "context" as const,
      content: `ctx ${i}`,
      oldLineNo: i + 1,
      newLineNo: i + 1,
    }));
    lines.splice(10, 0, { kind: "added", content: "new", newLineNo: 11 } as never);
    const rows = buildUnifiedRows({ filePath: "f", kind: "modified", hunks: [{ header: "@@", lines }] });
    const collapsed = rows.filter((r) => r.type === "collapsed");
    expect(collapsed.length).toBeGreaterThan(0);
    // @ts-expect-error narrowed
    expect(collapsed[0].hiddenCount).toBeGreaterThan(0);
  });
});

describe("buildSplitRows", () => {
  it("aligns removed on the left and added on the right", () => {
    const rows = buildSplitRows(modifiedDiff());
    const change = rows.find((r) => r.type === "line" && r.isChange);
    expect(change).toMatchObject({
      left: { kind: "removed", content: "hello world" },
      right: { kind: "added", content: "hello earth" },
    });
  });

  it("pads with blank cells for unbalanced insertions", () => {
    const input: DiffInput = {
      filePath: "f",
      kind: "added",
      hunks: [
        {
          header: "@@ -0,0 +1,2 @@",
          lines: [
            { kind: "added", content: "a", newLineNo: 1 },
            { kind: "added", content: "b", newLineNo: 2 },
          ],
        },
      ],
    };
    const rows = buildSplitRows(input);
    const lines = rows.filter((r) => r.type === "line");
    expect(lines).toHaveLength(2);
    // @ts-expect-error narrowed
    expect(lines[0].left.kind).toBe("blank");
    // @ts-expect-error narrowed
    expect(lines[0].right.kind).toBe("added");
  });
});

describe("diffPlaceholder", () => {
  it("returns a binary placeholder with byte count", () => {
    const p = diffPlaceholder({ filePath: "img.png", kind: "modified", hunks: [], isBinary: true, byteSize: 2048 });
    expect(p.kind).toBe("binary");
    expect(p.label).toContain("Binary file");
    expect(p.canShowAnyway).toBe(false);
  });

  it("gates too-large files behind show-anyway and auto-detects by byte size", () => {
    const big: DiffInput = { filePath: "big.ts", kind: "modified", hunks: [], byteSize: TOO_LARGE_BYTES + 1 };
    expect(diffPlaceholder(big).kind).toBe("too_large");
    expect(diffPlaceholder(big).canShowAnyway).toBe(true);
    expect(diffPlaceholder(big, true).kind).toBeNull();
  });

  it("returns null for a normal file", () => {
    expect(diffPlaceholder({ filePath: "f", kind: "modified", hunks: [], byteSize: 100 }).kind).toBeNull();
  });
});

describe("scroll-to-change navigation", () => {
  const rows = buildUnifiedRows(modifiedDiff());
  const changes = changeRowIndices(rows);

  it("finds change row indices", () => {
    expect(changes.length).toBe(2); // removed + added
  });

  it("navigates next/prev with wraparound", () => {
    const first = changes[0]!;
    const last = changes[changes.length - 1]!;
    expect(nextChangeIndex(changes, first)).toBe(changes[1]);
    expect(nextChangeIndex(changes, last)).toBe(first); // wrap
    expect(prevChangeIndex(changes, last)).toBe(changes[0]);
    expect(prevChangeIndex(changes, first)).toBe(last); // wrap
    expect(nextChangeIndex([], 0)).toBeNull();
  });
});

describe("hunkToText", () => {
  it("reconstructs a unified-diff hunk with +/-/space prefixes", () => {
    const text = hunkToText(modifiedDiff().hunks[0]!);
    expect(text).toBe("@@ -1,3 +1,3 @@\n line one\n-hello world\n+hello earth\n line three");
  });
});

describe("formatBytes", () => {
  it("formats bytes, KB, MB", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
  });
});
