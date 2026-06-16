/**
 * Server-side syntax highlighting (MAIN-SCOPE §3 Highlight package). Produces a stable, serializable
 * token stream consumed by file previews (features/file-explorer-transfer.md) and git diff rendering
 * (features/git-checkout.md). Pure-JS / dependency-free regex tokenizer with graceful plain-text
 * fallback. Concatenating `tokens[].value` in order exactly reproduces the source (lossless).
 *
 * TODO(verify): the original package's exact highlighter library / grammar set.
 */

export type TokenType =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "punctuation"
  | "identifier"
  | "text";

export interface HighlightToken {
  type: TokenType;
  value: string;
}

export interface HighlightResult {
  language: Language;
  tokens: HighlightToken[];
}

export type Language = "typescript" | "javascript" | "json" | "plaintext";

const EXTENSION_LANGUAGE: Record<string, Language> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
};

const KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "new",
  "class",
  "extends",
  "super",
  "this",
  "import",
  "export",
  "from",
  "as",
  "default",
  "async",
  "await",
  "yield",
  "try",
  "catch",
  "finally",
  "throw",
  "typeof",
  "instanceof",
  "in",
  "of",
  "void",
  "delete",
  "interface",
  "type",
  "enum",
  "implements",
  "public",
  "private",
  "protected",
  "readonly",
  "static",
  "abstract",
  "namespace",
  "declare",
  "true",
  "false",
  "null",
  "undefined",
]);

/** Detect a language from a file path / extension hint. Unknown → plaintext. */
export function detectLanguage(pathOrHint: string | undefined): Language {
  if (!pathOrHint) return "plaintext";
  const hint = pathOrHint.toLowerCase();
  // Direct language name hint.
  if (hint === "typescript" || hint === "ts") return "typescript";
  if (hint === "javascript" || hint === "js") return "javascript";
  if (hint === "json") return "json";
  const ext = hint.includes(".") ? (hint.split(".").at(-1) ?? "") : hint;
  return EXTENSION_LANGUAGE[ext] ?? "plaintext";
}

/** Highlight `source` for the given language/path hint. */
export function highlight(source: string, hint?: string): HighlightResult {
  const language = detectLanguage(hint);
  if (language === "plaintext") {
    return { language, tokens: source.length > 0 ? [{ type: "text", value: source }] : [] };
  }
  return { language, tokens: tokenize(source, language) };
}

// Token matchers tried in priority order. Each returns the matched length at offset 0 of `rest`.
type Matcher = { type: TokenType; re: RegExp };

const CODE_MATCHERS: Matcher[] = [
  { type: "comment", re: /^\/\/[^\n]*/ },
  { type: "comment", re: /^\/\*[\s\S]*?(?:\*\/|$)/ },
  { type: "string", re: /^"(?:\\.|[^"\\])*"/ },
  { type: "string", re: /^'(?:\\.|[^'\\])*'/ },
  { type: "string", re: /^`(?:\\.|[^`\\])*`/ },
  { type: "number", re: /^0[xX][0-9a-fA-F]+|^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/ },
  { type: "identifier", re: /^[A-Za-z_$][\w$]*/ },
  { type: "punctuation", re: /^[{}()[\];:,.<>+\-*/%=!&|^~?@]+/ },
];

const JSON_MATCHERS: Matcher[] = [
  { type: "string", re: /^"(?:\\.|[^"\\])*"/ },
  { type: "number", re: /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/ },
  { type: "keyword", re: /^(?:true|false|null)\b/ },
  { type: "punctuation", re: /^[{}[\]:,]+/ },
];

function tokenize(source: string, language: Language): HighlightToken[] {
  const matchers = language === "json" ? JSON_MATCHERS : CODE_MATCHERS;
  const tokens: HighlightToken[] = [];
  let rest = source;
  let pendingText = "";

  const flushText = (): void => {
    if (pendingText) {
      tokens.push({ type: "text", value: pendingText });
      pendingText = "";
    }
  };

  while (rest.length > 0) {
    // Whitespace is preserved as plain text (keeps the stream lossless).
    const ws = /^\s+/.exec(rest);
    if (ws) {
      pendingText += ws[0];
      rest = rest.slice(ws[0].length);
      continue;
    }

    let matched = false;
    for (const matcher of matchers) {
      const m = matcher.re.exec(rest);
      if (m && m[0].length > 0) {
        flushText();
        const value = m[0];
        let type = matcher.type;
        // An identifier that is a reserved word becomes a keyword (code languages only).
        if (type === "identifier" && KEYWORDS.has(value)) type = "keyword";
        tokens.push({ type, value });
        rest = rest.slice(value.length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Unknown character → accumulate as text, advance one char.
      pendingText += rest[0];
      rest = rest.slice(1);
    }
  }

  flushText();
  return tokens;
}
