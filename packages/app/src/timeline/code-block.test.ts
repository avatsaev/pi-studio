import { describe, it, expect } from "vitest";
import { buildCodeBlock, isSupportedLanguage, SUPPORTED_CODE_LANGUAGES } from "./code-block.js";

describe("buildCodeBlock", () => {
  it("normalizes the language alias and returns highlighted lines", () => {
    const model = buildCodeBlock("const x = 1;\nconst y = 2;", "typescript");
    expect(model.language).toBe("ts");
    expect(model.raw).toBe("const x = 1;\nconst y = 2;");
    expect(model.lines).toHaveLength(2);
    // each line carries at least one span
    expect(model.lines[0]!.spans.length).toBeGreaterThan(0);
  });

  it("produces one highlighted line per source line", () => {
    const model = buildCodeBlock("a\nb\nc", "js");
    expect(model.lines.map((l) => l.lineIndex)).toEqual([0, 1, 2]);
  });

  it("prefers server-provided spans when present", () => {
    const model = buildCodeBlock("hello", "ts", [{ type: "string", value: "hello" }]);
    expect(model.lines[0]!.spans[0]!.type).toBe("string");
  });

  it("handles an unknown/empty language gracefully", () => {
    const model = buildCodeBlock("plain text", "");
    expect(model.lines).toHaveLength(1);
  });
});

describe("isSupportedLanguage", () => {
  it("recognizes the top-N languages and their aliases", () => {
    expect(isSupportedLanguage("typescript")).toBe(true);
    expect(isSupportedLanguage("ts")).toBe(true);
    expect(isSupportedLanguage("python")).toBe(true);
    expect(isSupportedLanguage("bash")).toBe(true); // alias → sh
    expect(isSupportedLanguage("brainfuck")).toBe(false);
  });

  it("advertises a non-empty supported set", () => {
    expect(SUPPORTED_CODE_LANGUAGES.length).toBeGreaterThanOrEqual(10);
  });
});
