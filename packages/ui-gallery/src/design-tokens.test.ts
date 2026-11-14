import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countTokenUsage, findTokenProblems } from "@av-pi-studio/ui-library";

// The gallery's own CSS/TSX must only reference tokens the library really emits.
const SRC = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(css|ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("ui-gallery design tokens", () => {
  it("references only tokens the library emits", () => {
    expect(findTokenProblems(files)).toEqual([]);
  });

  it("actually uses library tokens (guards against an empty scan)", () => {
    expect(countTokenUsage(files).varRefs).toBeGreaterThan(5);
  });
});
