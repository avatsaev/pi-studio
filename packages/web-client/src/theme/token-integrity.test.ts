import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { flattenThemeToVars } from "./css-bridge.js";
import { getTheme } from "./theme.js";
import { THEME_NAMES } from "./variants.js";

// css-bridge.ts emits `--pi-*`/`--syntax-*` custom properties VERBATIM from each theme's key
// names — there is no build-time check that a `var(--pi-color-whatever)` reference anywhere in
// the app actually corresponds to a real key, OR that an emitted key is even syntactically legal
// CSS. Two ways that silently breaks:
//  1. A typo'd or renamed token (`--pi-color-surface` instead of `--pi-color-surface1`,
//     `--pi-borderRadius-md` instead of `--pi-radius-md`, an invented name like
//     `--pi-color-surfaceHover` that was never emitted) — falls through to the
//     `var(fallback, <literal>)` and freezes at that one literal in every theme variant forever
//     (65 such references shipped unnoticed across 14 files; see the P1 fix this test came from).
//  2. A token KEY that isn't a legal CSS custom-property identifier — e.g. a fractional spacing
//     key like `"1.5"` emits `--pi-spacing-1.5`, which browsers reject outright (a CSS ident
//     cannot contain a literal `.`); with no `, <fallback>` at the call site (P2 deliberately
//     stripped those as redundant once every reference resolves), the property doesn't just
//     miss its intended value, it resolves to NOTHING and the padding/margin/gap collapses to
//     `0` app-wide. This shipped and broke visible spacing in every theme before it was caught.
// font-scale.test.ts already guards case 1 for `font-size` specifically; this test generalizes
// both checks to every `--pi-*`/`--syntax-*` token, across every source file (not just `.css`),
// using the SAME mechanism css-bridge.ts uses at runtime — so "real token" here means "a key
// `flattenThemeToVars` actually emits", not a hand-maintained allowlist that can itself drift.

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(css|ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

// Every `--pi-*`/`--syntax-*` name any theme variant actually emits. All six variants share the
// same ThemeColors shape, so this is normally variant-invariant — union them anyway so a future
// variant-specific key is caught by its own presence, not by coincidentally matching another.
const emitted = new Set<string>();
for (const name of THEME_NAMES) {
  for (const key of Object.keys(flattenThemeToVars(getTheme(name)))) emitted.add(key);
}

type Ref = { file: string; name: string };

const refs: Ref[] = sourceFiles(SRC).flatMap((file) => {
  // Strip comments so documentation prose ("...resolves through `var(--pi-font-size-*)`...", "a
  // stale `var(--pi-color-typo)` reference...") never gets scanned as a real reference.
  const text = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const relFile = file.slice(SRC.length + 1);
  return [...text.matchAll(/var\(\s*(--(?:pi|syntax)-[a-zA-Z0-9_.-]+)(\$\{)?/g)]
    .filter((m) => m[2] === undefined) // skip dynamic template refs, e.g. `` `var(--pi-color-surface${elevation})` `` — the name isn't statically known, can't be checked here.
    .map((m) => ({ file: relFile, name: m[1]! }));
});

describe("design-token wiring (--pi-*/--syntax-* custom properties)", () => {
  it("finds the var() references it is meant to be guarding", () => {
    expect(refs.length).toBeGreaterThan(300);
  });

  it("resolves every var(--pi-*)/var(--syntax-*) reference to a token the theme actually emits", () => {
    const dangling = refs.filter((ref) => !emitted.has(ref.name));

    expect(dangling).toEqual([]);
  });

  it("emits only syntactically legal CSS custom-property names (no literal `.` etc. in the key)", () => {
    // A CSS custom-property ident allows letters, digits, `-`, and `_` after the leading `--`;
    // a literal `.` (or any other punctuation) makes the browser reject the whole declaration,
    // so `var()` resolves to nothing with no error — the silent, app-wide breakage this guards.
    const illegal = [...emitted].filter((name) => !/^--(?:pi|syntax)-[a-zA-Z0-9_-]+$/.test(name));

    expect(illegal).toEqual([]);
  });
});
