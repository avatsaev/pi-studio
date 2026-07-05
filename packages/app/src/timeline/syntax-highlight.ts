// Client-side syntax highlighting bridge to @av-pi-studio/highlight.
// clean-room-scope/features/timeline-rendering.md § Syntax highlighting

import { detectLanguage, highlight } from "@av-pi-studio/highlight";
import { normalizeLanguage } from "./markdown.js";

export type HighlightSpan = { type: string; value: string };

export type HighlightedLine = {
  lineIndex: number;
  spans: HighlightSpan[];
};

// Highlight a code string (server spans preferred; client-side fallback otherwise).
export function highlightCode(
  code: string,
  langHint: string,
  serverSpans?: readonly HighlightSpan[],
): HighlightedLine[] {
  if (serverSpans && serverSpans.length > 0) {
    return applyServerSpans(code, serverSpans);
  }
  const lang = normalizeLanguage(langHint);
  const detectedLang = detectLanguage(lang.length <= 6 && /^\w+$/.test(lang) ? `file.${lang}` : lang);
  const result = highlight(code, detectedLang);
  return tokenLinesToLines(code, result.tokens);
}

// Token-kind → color CSS-variable name (reads theme.colors.syntax.*)
export function tokenColorVar(type: string): string {
  const known = new Set([
    "keyword", "string", "number", "boolean", "comment", "function", "variable",
    "type", "class", "constant", "operator", "punctuation", "tag", "attribute",
    "property", "regexp", "escape", "heading", "link", "deleted", "inserted",
  ]);
  return known.has(type) ? `var(--syntax-${type})` : "var(--syntax-text, inherit)";
}

function applyServerSpans(code: string, spans: readonly HighlightSpan[]): HighlightedLine[] {
  const lines = code.split("\n");
  const lineLines: HighlightedLine[] = [];
  let spanIndex = 0;
  let charPos = 0;
  const spanBuffer: HighlightSpan[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineStart = charPos;
    const lineEnd = charPos + lines[lineIndex]!.length;
    const lineSpans: HighlightSpan[] = [];

    while (spanIndex < spans.length) {
      const span = spans[spanIndex]!;
      const consumed = spanBuffer.reduce((n, s) => n + s.value.length, 0);
      if (consumed >= lineEnd - lineStart) break;
      lineSpans.push({ type: span.type, value: span.value });
      spanIndex++;
    }

    lineLines.push({ lineIndex, spans: lineSpans.length > 0 ? lineSpans : [{ type: "text", value: lines[lineIndex]! }] });
    charPos = lineEnd + 1; // +1 for the newline
  }
  return lineLines;
}

function tokenLinesToLines(code: string, tokens: readonly HighlightSpan[]): HighlightedLine[] {
  const lines = code.split("\n");
  const lineLines: HighlightedLine[] = [];
  let tokenIndex = 0;
  let offsetInToken = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineText = lines[lineIndex]!;
    let remaining = lineText.length;
    const spans: HighlightSpan[] = [];

    while (remaining > 0 && tokenIndex < tokens.length) {
      const token = tokens[tokenIndex]!;
      const available = token.value.length - offsetInToken;
      if (available <= remaining) {
        spans.push({ type: token.type, value: token.value.slice(offsetInToken) });
        remaining -= available;
        tokenIndex++;
        offsetInToken = 0;
      } else {
        spans.push({ type: token.type, value: token.value.slice(offsetInToken, offsetInToken + remaining) });
        offsetInToken += remaining;
        remaining = 0;
      }
    }
    if (remaining > 0) spans.push({ type: "text", value: lineText.slice(lineText.length - remaining) });
    lineLines.push({ lineIndex, spans: spans.length > 0 ? spans : [{ type: "text", value: lineText }] });
    tokenIndex++; // skip \n token boundary
  }
  return lineLines;
}
