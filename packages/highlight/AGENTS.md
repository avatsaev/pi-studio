# `@av-pi-studio/highlight` — AGENTS.md

Server-side syntax-highlighting helper.
Pure-JavaScript regex tokeniser — no external highlighting library, no runtime dependencies.

---

## Purpose

Produces a stable, serialisable **token stream** from source text. The token stream is:

- **Lossless** — concatenating `token.value` for all tokens in order exactly reproduces the
  original source string.
- **Language-aware** — TypeScript/JavaScript, JSON, and plaintext are handled; unknown files fall
  back to plaintext (one `text` token per source).
- **Consumed by** the daemon's file preview (`features/file-explorer-transfer.md`) and git diff
  rendering (`features/git-checkout.md`). Clients receive the token array and apply their own
  theme/styling.

---

## Source layout

```
src/
  index.ts          Re-exports everything from highlight.ts.
  highlight.ts      detectLanguage(), highlight(), tokenize(), all types.
  highlight.test.ts
```

---

## Public API (`src/highlight.ts`)

### Types

```ts
type TokenType = "keyword" | "string" | "comment" | "number" | "punctuation" | "identifier" | "text";

interface HighlightToken {
  type: TokenType;
  value: string;
}

interface HighlightResult {
  language: Language;   // "typescript" | "javascript" | "json" | "plaintext"
  tokens: HighlightToken[];
}

type Language = "typescript" | "javascript" | "json" | "plaintext";
```

### Functions

#### `detectLanguage(pathOrHint?: string): Language`

Infers a `Language` from a file path, extension, or short hint string.

| Input | Result |
|-------|--------|
| `"foo.ts"`, `"foo.tsx"`, `"foo.mts"`, `"foo.cts"` | `"typescript"` |
| `"foo.js"`, `"foo.jsx"`, `"foo.mjs"`, `"foo.cjs"` | `"javascript"` |
| `"foo.json"` | `"json"` |
| anything else / undefined | `"plaintext"` |

Also accepts bare language name hints: `"typescript"`, `"ts"`, `"javascript"`, `"js"`, `"json"`.

#### `highlight(source: string, hint?: string): HighlightResult`

Tokenise `source`, detecting the language from `hint`. Returns `{ language, tokens }`.
For `plaintext`, returns a single `{ type: "text", value: source }` token (or empty array for
empty source).

---

## Tokeniser behaviour

Two token-matcher tables are used:

**Code (TypeScript/JavaScript) — `CODE_MATCHERS` (priority order):**
1. `//…` single-line comments → `"comment"`
2. `/* … */` block comments (greedy to end-of-input if unclosed) → `"comment"`
3. `"…"` / `'…'` / `` `…` `` string literals (escape-aware) → `"string"`
4. Hex literals `0x…` or numeric literals with optional fraction/exponent → `"number"`
5. Identifiers `/[A-Za-z_$][\w$]*/` → `"identifier"` (promoted to `"keyword"` if in `KEYWORDS`)
6. Punctuation `/[{}()[\];:,.<>+\-*/%=!&|^~?@]+/` → `"punctuation"`

**JSON — `JSON_MATCHERS`:**
1. `"…"` string literals → `"string"`
2. Numeric literals → `"number"`
3. `true | false | null` → `"keyword"`
4. `{}[],:` → `"punctuation"`

**Whitespace** is always accumulated as `"text"` (preserves indentation/newlines losslessly).

**Unknown characters** (no matcher matches) are accumulated one character at a time as `"text"`.

**Pending text flush**: accumulated `"text"` is emitted as a single token before any non-text token.

**Keyword set** (TypeScript/JavaScript only): `const`, `let`, `var`, `function`, `return`, `if`,
`else`, `for`, `while`, `do`, `switch`, `case`, `break`, `continue`, `new`, `class`, `extends`,
`super`, `this`, `import`, `export`, `from`, `as`, `default`, `async`, `await`, `yield`, `try`,
`catch`, `finally`, `throw`, `typeof`, `instanceof`, `in`, `of`, `void`, `delete`, `interface`,
`type`, `enum`, `implements`, `public`, `private`, `protected`, `readonly`, `static`, `abstract`,
`namespace`, `declare`, `true`, `false`, `null`, `undefined`.

---

## Invariants

- **Lossless**: `tokens.map(t => t.value).join("") === source` must always hold. Do not skip or
  transform characters.
- **No external dependencies**: this package has no `dependencies` in `package.json`. Do not add
  any.
- **No Node-only APIs**: the tokeniser is pure JavaScript and must run in browser/RN.
- **Graceful fallback**: unknown languages and parse failures fall back to `plaintext`, never throw.

---

## Extending

To add a new language:

1. Add the extension → language mapping to `EXTENSION_LANGUAGE`.
2. Add the language to the `Language` type.
3. Create a matcher table (array of `{ type, re }`) and wire it in `tokenize()`.
4. Add the language guard to `detectLanguage()`.
5. Add tests in `highlight.test.ts`.

---

## Testing

```bash
npx vitest run packages/highlight
```
