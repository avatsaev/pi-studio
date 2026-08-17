/**
 * `splitStreamingMarkdown` is what lets a streaming row render markdown live: every completed
 * block is parsed once and memoized, only the tail re-parses per token delta. A wrong cut is a
 * visible mid-stream artifact (a half-open fence handed to Shiki, an indented list continuation
 * rendering as a code box), so each boundary rule is pinned here.
 */

import { describe, expect, it } from "vitest";
import { splitStreamingMarkdown } from "./streaming-split.js";

describe("splitStreamingMarkdown", () => {
  it("keeps a single growing paragraph entirely in the tail", () => {
    expect(splitStreamingMarkdown("I'll check the **fi")).toEqual({
      blocks: [],
      tail: "I'll check the **fi",
    });
  });

  it("returns nothing for empty text", () => {
    expect(splitStreamingMarkdown("")).toEqual({ blocks: [], tail: "" });
  });

  it("cuts completed blocks at blank lines and drops the separators", () => {
    expect(splitStreamingMarkdown("# Plan\n\nFirst step is to\n\nread the fi")).toEqual({
      blocks: ["# Plan", "First step is to"],
      tail: "read the fi",
    });
  });

  it("waits for the next block's first line before cutting on a trailing blank line", () => {
    // Deliberately conservative: the very next chunk could be an indented list continuation, and
    // committing the block now would strand that continuation as its own (code-block) block for
    // the rest of the turn. The delay is one token.
    expect(splitStreamingMarkdown("done.\n\n")).toEqual({ blocks: [], tail: "done.\n\n" });
  });

  it("holds an unterminated fence in the tail, blank lines and all", () => {
    const text = "Here:\n\n```ts\nconst a = 1;\n\nconst b = 2;";
    expect(splitStreamingMarkdown(text)).toEqual({
      blocks: ["Here:"],
      tail: "```ts\nconst a = 1;\n\nconst b = 2;",
    });
  });

  it("cuts right after a column-0 closing fence, without waiting for a blank line", () => {
    const text = "```ts\nconst a = 1;\n```\nand then";
    expect(splitStreamingMarkdown(text)).toEqual({
      blocks: ["```ts\nconst a = 1;\n```"],
      tail: "and then",
    });
  });

  it("closes a fence only on a marker at least as long as the opener", () => {
    const text = "````ts\n```\nstill inside\n````\nafter";
    expect(splitStreamingMarkdown(text)).toEqual({
      blocks: ["````ts\n```\nstill inside\n````"],
      tail: "after",
    });
  });

  it("does not cut a fence that belongs to a list item", () => {
    const text = "1. run this:\n\n   ```sh\n   ls\n   ```\n";
    expect(splitStreamingMarkdown(text)).toEqual({
      blocks: [],
      tail: "1. run this:\n\n   ```sh\n   ls\n   ```\n",
    });
  });

  it("keeps an indented list continuation with its item (it would parse as a code block alone)", () => {
    const text = "1. step one\n\n   more about step one\n\n2. step ";
    expect(splitStreamingMarkdown(text)).toEqual({
      blocks: [],
      tail: text,
    });
  });

  it("never cuts between two list blocks — a loose list stays one list", () => {
    const text = "- a\n\n- b\n\n- c";
    expect(splitStreamingMarkdown(text)).toEqual({ blocks: [], tail: text });
  });

  it("cuts a list off from the prose that follows it", () => {
    const text = "- a\n- b\n\nThat covers it";
    expect(splitStreamingMarkdown(text)).toEqual({
      blocks: ["- a\n- b"],
      tail: "That covers it",
    });
  });

  it("holds an open $$ math block in the tail", () => {
    const text = "Result:\n\n$$\nx = 1\n\ny = 2";
    expect(splitStreamingMarkdown(text)).toEqual({
      blocks: ["Result:"],
      tail: "$$\nx = 1\n\ny = 2",
    });
  });

  it("treats a closed $$ block as ordinary content and cuts after it", () => {
    const text = "$$\nx = 1\n$$\n\nand so";
    expect(splitStreamingMarkdown(text)).toEqual({ blocks: ["$$\nx = 1\n$$"], tail: "and so" });
  });

  it("does not toggle math on a single-line $$x$$ block", () => {
    const text = "$$x$$\n\nnext";
    expect(splitStreamingMarkdown(text)).toEqual({ blocks: ["$$x$$"], tail: "next" });
  });

  it("only ever appends to blocks as more text streams in (index keys stay stable)", () => {
    const full = "# Plan\n\nFirst para.\n\n```ts\nconst a = 1;\n```\n\n- one\n- two\n\nDone.";
    let previous: string[] = [];
    for (let end = 1; end <= full.length; end++) {
      const { blocks } = splitStreamingMarkdown(full.slice(0, end));
      expect(blocks.slice(0, previous.length)).toEqual(previous);
      previous = blocks;
    }
    expect(previous).toEqual(["# Plan", "First para.", "```ts\nconst a = 1;\n```", "- one\n- two"]);
  });

  it("reassembles the original text from blocks plus tail (modulo blank separators)", () => {
    const text = "# Plan\n\nprose here\n\n```ts\nconst a = 1;\n```\n\ntrailing tex";
    const { blocks, tail } = splitStreamingMarkdown(text);
    expect([...blocks, tail].join("\n\n")).toBe(text);
  });
});
