import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUTTON_FONT_SIZE } from "../ui/button.js";
import { baseFontSize } from "./tokens.js";
import { countTokenUsage, findTokenProblems, type TokenSourceFile } from "./token-guard.js";

const clean: TokenSourceFile[] = [
  {
    path: "ok.css",
    text: ".a { color: var(--pi-color-surface1); font-size: var(--pi-font-size-sm); }",
  },
  { path: "ok.ts", text: "const x = `var(--pi-color-surface${n})`; // var(--pi-color-typo)" },
];

describe("findTokenProblems (in-memory)", () => {
  it("reports nothing for a clean fixture, skipping dynamic refs and comments", () => {
    expect(findTokenProblems(clean)).toEqual([]);
  });

  it("flags a dangling var reference", () => {
    const problems = findTokenProblems([
      ...clean,
      { path: "bad.css", text: ".a { color: var(--pi-color-nope); }" },
    ]);
    expect(problems.map((p) => [p.kind, p.path])).toEqual([["dangling-var", "bad.css"]]);
  });

  it("flags a literal font-size", () => {
    const problems = findTokenProblems([{ path: "bad.css", text: ".a { font-size: 12px; }" }]);
    expect(problems.map((p) => p.kind)).toEqual(["literal-font-size"]);
  });

  it("flags a font-size rung that does not exist", () => {
    const problems = findTokenProblems([
      { path: "bad.css", text: ".a { font-size: var(--pi-font-size-nope); }" },
    ]);
    expect(problems.map((p) => p.kind)).toContain("unknown-font-rung");
  });
});

describe("button font sizes", () => {
  it("maps every button size to a real rung", () => {
    for (const value of Object.values(BUTTON_FONT_SIZE)) {
      const rung = /^var\(--pi-font-size-([\w-]+)\)$/.exec(value)?.[1];
      expect(rung).toBeDefined();
      expect(baseFontSize).toHaveProperty(rung!);
    }
  });
});

function sourceFiles(dir: string): TokenSourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(css|ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")
      ? [{ path: full, text: readFileSync(full, "utf8") }]
      : [];
  });
}

describe("ui-library source tree", () => {
  const files = sourceFiles(fileURLToPath(new URL("..", import.meta.url)));

  it("has no token problems", () => {
    expect(findTokenProblems(files)).toEqual([]);
  });

  it("still finds the references it guards", () => {
    const usage = countTokenUsage(files);
    expect(usage.varRefs).toBeGreaterThan(0);
    expect(usage.fontSizeDeclarations).toBeGreaterThan(0);
  });
});
