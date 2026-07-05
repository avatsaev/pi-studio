import { describe, expect, it } from "vitest";
import { highlightCode, nextCopyState, normalizeLanguage, parseMarkdownBlocks, tokenColorVar } from "./index.js";

describe("markdown parser", () => {
  it("parses ATX headings of all levels", () => {
    const md = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6";
    const { blocks } = parseMarkdownBlocks(md);
    const headings = blocks.filter((b) => b.kind === "heading");
    expect(headings).toHaveLength(6);
    expect((headings[0] as { level: number }).level).toBe(1);
    expect((headings[5] as { level: number }).level).toBe(6);
  });

  it("parses fenced code blocks with language tag", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const { blocks, streamingFenceOpen } = parseMarkdownBlocks(md);
    expect(blocks[0]?.kind).toBe("code_block");
    expect((blocks[0] as { language: string }).language).toBe("typescript");
    expect(streamingFenceOpen).toBe(false);
  });

  it("does not crash on unclosed streaming fences", () => {
    const md = "```typescript\nconst x = 1;\n// streaming";
    const { blocks, streamingFenceOpen } = parseMarkdownBlocks(md);
    expect(blocks[0]?.kind).toBe("code_block");
    expect(streamingFenceOpen).toBe(true);
  });

  it("parses bullet and ordered lists", () => {
    const { blocks } = parseMarkdownBlocks("- a\n- b\n- c");
    expect(blocks[0]?.kind).toBe("bullet_list");
    expect((blocks[0] as { items: string[] }).items).toEqual(["a", "b", "c"]);

    const { blocks: ordered } = parseMarkdownBlocks("1. first\n2. second");
    expect(ordered[0]?.kind).toBe("ordered_list");
    expect((ordered[0] as { start: number }).start).toBe(1);
  });

  it("parses blockquotes", () => {
    const { blocks } = parseMarkdownBlocks("> Quoted text\n> more");
    expect(blocks[0]?.kind).toBe("blockquote");
    expect((blocks[0] as { text: string }).text).toContain("Quoted");
  });

  it("parses horizontal rules", () => {
    expect(parseMarkdownBlocks("---").blocks[0]?.kind).toBe("rule");
    expect(parseMarkdownBlocks("***").blocks[0]?.kind).toBe("rule");
  });

  it("parses GFM tables", () => {
    const { blocks } = parseMarkdownBlocks("| A | B |\n| - | - |\n| 1 | 2 |");
    expect(blocks[0]?.kind).toBe("table");
    expect((blocks[0] as { headers: string[] }).headers).toEqual(["A", "B"]);
    expect((blocks[0] as { rows: string[][] }).rows[0]).toEqual(["1", "2"]);
  });

  it("parses images", () => {
    const { blocks } = parseMarkdownBlocks("![alt](https://example.com/img.png)");
    expect(blocks[0]?.kind).toBe("image");
    expect((blocks[0] as { src: string }).src).toBe("https://example.com/img.png");
  });

  it("wraps generic text in paragraphs", () => {
    const { blocks } = parseMarkdownBlocks("Hello world\nstill paragraph\n\nNew para");
    expect(blocks[0]?.kind).toBe("paragraph");
    expect(blocks[1]?.kind).toBe("paragraph");
  });
});

describe("language normalization", () => {
  it("normalizes common aliases to short codes", () => {
    expect(normalizeLanguage("typescript")).toBe("ts");
    expect(normalizeLanguage("JavaScript")).toBe("js");
    expect(normalizeLanguage("Python")).toBe("py");
    expect(normalizeLanguage("RUST")).toBe("rs");
    expect(normalizeLanguage("sh")).toBe("sh");
  });
});

describe("syntax highlighting", () => {
  it("highlights TypeScript code with the client-side tokenizer", () => {
    const lines = highlightCode("const x = 1;", "ts");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]!.spans.length).toBeGreaterThan(0);
  });

  it("prefers server spans when provided", () => {
    const serverSpans = [{ type: "keyword", value: "const" }, { type: "text", value: " x = 1;" }];
    const lines = highlightCode("const x = 1;", "ts", serverSpans);
    expect(lines[0]!.spans[0]?.type).toBe("keyword");
  });

  it("tokenColorVar maps known types to CSS variables", () => {
    expect(tokenColorVar("keyword")).toBe("var(--syntax-keyword)");
    expect(tokenColorVar("string")).toBe("var(--syntax-string)");
    expect(tokenColorVar("something_unknown")).toBe("var(--syntax-text, inherit)");
  });
});

describe("copy button state", () => {
  it("cycles idle → copied → idle with reset timer", () => {
    const first = nextCopyState("idle");
    expect(first.state).toBe("copied");
    expect(first.resetAfterMs).toBe(2000);
    expect(nextCopyState("copied").state).toBe("idle");
  });
});
