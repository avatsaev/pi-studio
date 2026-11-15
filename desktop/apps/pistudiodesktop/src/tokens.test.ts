import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Colours come from design tokens, never from literals in components or their style sheets. This is
// the check: it reads every style sheet and every component (an inline `style` counts too).
const src = path.dirname(fileURLToPath(import.meta.url));
const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(/;

function styled(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return styled(file);
    }
    return /\.(css|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.tsx") && entry.name !== "tokens.css" ? [file] : [];
  });
}

describe("design tokens", () => {
  it("are the only place a colour is written", () => {
    const files = styled(src);
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const offending = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => literal.test(line));
      expect(offending, `${path.relative(src, file)}: use a var(--token) from tokens.css`).toEqual([]);
    }
  });

  it("define the same tokens for every theme", () => {
    const css = readFileSync(path.join(src, "tokens.css"), "utf8");
    const blocks = [...css.matchAll(/\{([^}]*)\}/g)].map((block) => [...block[1].matchAll(/(--[\w-]+)\s*:/g)].map((token) => token[1]).sort());
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toEqual(blocks[1]);
  });
});
