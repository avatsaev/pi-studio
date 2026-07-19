# `@av-pi-studio/highlight`

Server-side syntax-highlighting helper for Pi-Studio. A pure-JavaScript regex tokeniser — no
external highlighting library, and (deliberately) **no runtime dependencies at all**.

---

## Install

```bash
npm install @av-pi-studio/highlight
```

## What it does

Turns source text into a stable, serializable **token stream**. This token stream is what the
daemon sends to clients for file preview and git-diff rendering — the client then applies its own
theme/styling to the token types, rather than the server shipping pre-styled HTML.

Two properties the tokenizer guarantees:

- **Lossless** — concatenating every token's `value` in order reproduces the original source
  string exactly. No character is ever dropped, transformed, or reordered.
- **Graceful fallback** — an unrecognized language (or any tokenizing edge case) falls back to a
  single `plaintext` token rather than throwing.

## Usage

```ts
import { highlight, detectLanguage } from "@av-pi-studio/highlight";

const { language, tokens } = highlight(sourceText, "example.ts");
// language → "typescript"
// tokens   → [{ type: "keyword", value: "const" }, { type: "text", value: " " }, …]

detectLanguage("foo.tsx");   // → "typescript"
detectLanguage("foo.json");  // → "json"
detectLanguage("README.md"); // → "plaintext" (unrecognized extension)
```

### Types

```ts
type TokenType = "keyword" | "string" | "comment" | "number" | "punctuation" | "identifier" | "text";
type Language = "typescript" | "javascript" | "json" | "plaintext";

interface HighlightToken {
  type: TokenType;
  value: string;
}

interface HighlightResult {
  language: Language;
  tokens: HighlightToken[];
}
```

### `detectLanguage(pathOrHint?: string): Language`

Infers a language from a file path/extension, or accepts a bare hint string directly
(`"typescript"`, `"ts"`, `"javascript"`, `"js"`, `"json"`).

| Extension | Language |
|---|---|
| `.ts`, `.tsx`, `.mts`, `.cts` | `typescript` |
| `.js`, `.jsx`, `.mjs`, `.cjs` | `javascript` |
| `.json` | `json` |
| anything else / undefined | `plaintext` |

### `highlight(source: string, hint?: string): HighlightResult`

Tokenizes `source`, detecting the language via `detectLanguage(hint)`. `plaintext` input returns a
single `text` token wrapping the whole source (or an empty array for empty input).

## Supported languages

- **TypeScript / JavaScript** — comments (`//`, `/* */`), string literals (`"…"`, `'…'`,
  `` `…` ``, escape-aware), numeric literals (hex, decimal, fractional, exponent), identifiers
  (promoted to `keyword` against a fixed keyword set — `const`, `function`, `interface`, `async`,
  `typeof`, etc.), and punctuation.
- **JSON** — string/number literals, `true`/`false`/`null` as keywords, and structural punctuation.
- **Plaintext** — everything else; the whole input becomes one `text` token.

Whitespace is always preserved as `text` tokens (this is what keeps the tokenizer lossless), and
any character no matcher recognizes is emitted one-at-a-time as `text` rather than dropped.

## Extending with a new language

1. Add the extension → language mapping to `EXTENSION_LANGUAGE`.
2. Add the language to the `Language` type.
3. Write a matcher table (`{ type, re }[]`) and wire it into `tokenize()`.
4. Add the corresponding branch to `detectLanguage()`.
5. Add tests in `highlight.test.ts`.

## Development

```bash
npm run build       # tsc -b
npx vitest run packages/highlight
```

No `dependencies` in `package.json` — keep it that way; this package must stay usable anywhere
plain JavaScript runs.
