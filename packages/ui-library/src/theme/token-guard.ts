// Pure design-token guard: checks source text against what the theme system actually emits.
// React-free and node-free — callers supply `{ path, text }` pairs (tests read them from disk).
//
// Three silent failures this exists to catch:
//  1. A typo'd/renamed token (`var(--pi-color-surface)` for `--pi-color-surface1`) falls through
//     to a call-site fallback, or to nothing, in every theme variant.
//  2. An emitted key that is not a legal CSS custom-property ident (e.g. `--pi-spacing-1.5`) is
//     rejected by browsers, so `var()` resolves to nothing and layout collapses.
//  3. A literal `font-size` px/rem (or a missing rung) bypasses the `baseFontSize` scale.
import { flattenThemeToVars } from "./css-bridge.js";
import { baseFontSize } from "./tokens.js";
import { getTheme } from "./theme.js";
import { THEME_NAMES } from "./variants.js";

export type TokenProblemKind =
  | "dangling-var"
  | "illegal-key"
  | "literal-font-size"
  | "unknown-font-rung";

export interface TokenProblem {
  kind: TokenProblemKind;
  /** Source file, or `"(theme)"` for problems in emitted keys. */
  path: string;
  message: string;
}

export interface TokenSourceFile {
  path: string;
  text: string;
}

export interface TokenUsage {
  /** Static `var(--pi-*)`/`var(--syntax-*)` references examined. */
  varRefs: number;
  /** `font-size` declarations examined in `.css` files. */
  fontSizeDeclarations: number;
}

const VAR_REF = /var\(\s*(--(?:pi|syntax)-[a-zA-Z0-9_.-]+)(\$\{)?/g;
const FONT_SIZE_DECL = /font-size:\s*([^;]+);/g;
const FONT_RUNG_REF = /var\(\s*--pi-font-size-([\w-]+)/g;
const LEGAL_KEY = /^--(?:pi|syntax)-[a-zA-Z0-9_-]+$/;

// Every key any theme variant emits; unioned so a variant-specific key is judged on its own.
function emittedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const name of THEME_NAMES) {
    for (const key of Object.keys(flattenThemeToVars(getTheme(name)))) keys.add(key);
  }
  return keys;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function staticVarRefs(text: string): string[] {
  // Comments are stripped so prose never counts; dynamic `${` template refs have no static name.
  return [...stripComments(text).matchAll(VAR_REF)]
    .filter((m) => m[2] === undefined)
    .map((m) => m[1]!);
}

function fontSizeValues(file: TokenSourceFile): string[] {
  if (!file.path.endsWith(".css")) return [];
  return [...file.text.matchAll(FONT_SIZE_DECL)].map((m) => m[1]!.trim());
}

export function countTokenUsage(files: readonly TokenSourceFile[]): TokenUsage {
  let varRefs = 0;
  let fontSizeDeclarations = 0;
  for (const file of files) {
    varRefs += staticVarRefs(file.text).length;
    fontSizeDeclarations += fontSizeValues(file).length;
  }
  return { varRefs, fontSizeDeclarations };
}

export function findTokenProblems(files: readonly TokenSourceFile[]): TokenProblem[] {
  const emitted = emittedKeys();
  const problems: TokenProblem[] = [];

  for (const key of emitted) {
    if (!LEGAL_KEY.test(key)) {
      problems.push({
        kind: "illegal-key",
        path: "(theme)",
        message: `emitted key ${key} is not a legal CSS custom-property name`,
      });
    }
  }

  for (const file of files) {
    for (const name of staticVarRefs(file.text)) {
      if (!emitted.has(name)) {
        problems.push({
          kind: "dangling-var",
          path: file.path,
          message: `var(${name}) does not match any token the theme emits`,
        });
      }
    }
    for (const value of fontSizeValues(file)) {
      if (/\d\s*(px|rem)/.test(value)) {
        problems.push({
          kind: "literal-font-size",
          path: file.path,
          message: `font-size: ${value} is hardcoded; use a --pi-font-size-<rung> token`,
        });
      }
      for (const m of value.matchAll(FONT_RUNG_REF)) {
        if (!(m[1]! in baseFontSize)) {
          problems.push({
            kind: "unknown-font-rung",
            path: file.path,
            message: `--pi-font-size-${m[1]} is not a rung of baseFontSize`,
          });
        }
      }
    }
  }
  return problems;
}
