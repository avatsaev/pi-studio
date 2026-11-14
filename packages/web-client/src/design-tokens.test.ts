import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { countTokenUsage, findTokenProblems, type TokenSourceFile } from "@av-pi-studio/ui-library";

// Design-token wiring (`--pi-*`/`--syntax-*`, font-size scale) is checked by the library's pure
// `findTokenProblems`; this runs it over the web-client sources.
function sourceFiles(dir: string): TokenSourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(css|ts|tsx)$/.test(entry.name)
      ? [{ path: full, text: readFileSync(full, "utf8") }]
      : [];
  });
}

const files = sourceFiles(fileURLToPath(new URL(".", import.meta.url)));

describe("design-token wiring", () => {
  it("finds the references and font-size declarations it is meant to guard", () => {
    const usage = countTokenUsage(files);
    expect(usage.varRefs).toBeGreaterThan(100);
    expect(usage.fontSizeDeclarations).toBeGreaterThan(20);
  });

  it("has no dangling vars, illegal keys, or hardcoded font sizes", () => {
    expect(findTokenProblems(files)).toEqual([]);
  });
});
