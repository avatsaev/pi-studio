import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { baseFontSize } from "./tokens.js";
import { BUTTON_FONT_SIZE } from "../ui/button.js";

// theme/tokens.ts's `baseFontSize` is the single lever for the app's text size, which only holds
// if every `font-size` in the app actually resolves through it. Two ways that silently breaks:
// a stale hardcoded literal that no longer tracks the scale, or a `var(--pi-font-size-typo)` that
// resolves to nothing and inherits instead (exactly the markdown.module.css bug that shipped
// unnoticed). Both are caught here rather than by someone noticing odd text months later.

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.name.endsWith(".css") ? [full] : [];
  });
}

const declarations = cssFiles(SRC).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/font-size:\s*([^;]+);/g)].map((match) => ({
    file: file.slice(SRC.length + 1),
    value: match[1].trim(),
  })),
);

describe("font-size scale wiring", () => {
  it("finds the font-size declarations it is meant to be guarding", () => {
    expect(declarations.length).toBeGreaterThan(50);
  });

  it("resolves every --pi-font-size-* reference to a real rung", () => {
    const dangling = declarations
      .flatMap(({ file, value }) =>
        [...value.matchAll(/var\(\s*--pi-font-size-([\w-]+)/g)].map((m) => ({ file, rung: m[1] })),
      )
      .filter(({ rung }) => !(rung in baseFontSize));

    expect(dangling).toEqual([]);
  });

  it("never hardcodes an absolute font-size in a CSS module", () => {
    // Relative units (em/%) are legitimate — they scale with whatever rung the parent resolved to.
    const hardcoded = declarations.filter(({ value }) => /\d\s*(px|rem)/.test(value));

    expect(hardcoded).toEqual([]);
  });

  it("maps every button size to a real rung", () => {
    for (const value of Object.values(BUTTON_FONT_SIZE)) {
      const rung = /^var\(--pi-font-size-([\w-]+)\)$/.exec(value)?.[1];
      expect(rung).toBeDefined();
      expect(baseFontSize).toHaveProperty(rung!);
    }
  });
});
