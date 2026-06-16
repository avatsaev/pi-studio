import { describe, expect, it } from "vitest";

import { detectLanguage, highlight, type HighlightToken } from "./highlight.js";

const reassemble = (tokens: HighlightToken[]): string => tokens.map((t) => t.value).join("");

describe("detectLanguage", () => {
  it("maps extensions and language hints, falling back to plaintext", () => {
    expect(detectLanguage("foo.ts")).toBe("typescript");
    expect(detectLanguage("a/b/c.tsx")).toBe("typescript");
    expect(detectLanguage("script.js")).toBe("javascript");
    expect(detectLanguage("data.json")).toBe("json");
    expect(detectLanguage("typescript")).toBe("typescript");
    expect(detectLanguage("notes.xyz")).toBe("plaintext");
    expect(detectLanguage(undefined)).toBe("plaintext");
  });
});

describe("highlight", () => {
  it("tokenizes a known language into keyword/string/comment/number/identifier spans", () => {
    const src = `// hi\nconst x = "s" + 42;`;
    const result = highlight(src, "demo.ts");
    expect(result.language).toBe("typescript");
    const types = new Set(result.tokens.map((t) => t.type));
    expect(types.has("comment")).toBe(true);
    expect(types.has("keyword")).toBe(true); // const
    expect(types.has("string")).toBe(true); // "s"
    expect(types.has("number")).toBe(true); // 42
    expect(types.has("identifier")).toBe(true); // x
    // `const` classified as keyword, not identifier.
    expect(result.tokens.find((t) => t.value === "const")?.type).toBe("keyword");
  });

  it("is lossless — concatenated token values reproduce the source", () => {
    const src = `function add(a, b) {\n  return a + b; // sum\n}\n`;
    expect(reassemble(highlight(src, "f.ts").tokens)).toBe(src);
    expect(reassemble(highlight('{"k": [1, true, null]}', "x.json").tokens)).toBe(
      '{"k": [1, true, null]}',
    );
  });

  it("falls back to a single plain-text span for an unknown language", () => {
    const src = "some arbitrary text 123";
    const result = highlight(src, "file.unknownext");
    expect(result.language).toBe("plaintext");
    expect(result.tokens).toEqual([{ type: "text", value: src }]);
  });

  it("classifies JSON literals as keywords", () => {
    const result = highlight('{"on": true, "off": false, "x": null}', "c.json");
    const keywords = result.tokens.filter((t) => t.type === "keyword").map((t) => t.value);
    expect(keywords).toEqual(["true", "false", "null"]);
  });

  it("is deterministic for the same input", () => {
    const src = `const a = 1; const b = 2;`;
    expect(highlight(src, "a.ts")).toEqual(highlight(src, "a.ts"));
  });

  it("returns no tokens for empty source", () => {
    expect(highlight("", "a.ts").tokens).toEqual([]);
  });
});
