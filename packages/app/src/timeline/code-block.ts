// Code-block presentation: language resolution, highlighted lines, and copy state.
// clean-room-scope/features/timeline-rendering.md § Syntax highlighting, § code surfaces

import { highlightCode, type HighlightedLine } from "./syntax-highlight.js";
import { normalizeLanguage } from "./markdown.js";

/** Languages the code surfaces advertise support for (top-N). */
export const SUPPORTED_CODE_LANGUAGES = [
  "ts", "js", "py", "rs", "go", "json", "yaml", "sh", "sql", "html", "css", "md",
] as const;

export interface CodeBlockModel {
  /** Normalized language id (alias-resolved). */
  language: string;
  /** Highlighted lines ready for span rendering. */
  lines: HighlightedLine[];
  /** Raw code (for clipboard). */
  raw: string;
}

/**
 * Build a syntax-highlighted code block model from a fence language + code.
 * Server-provided spans are preferred when available.
 */
export function buildCodeBlock(
  code: string,
  languageHint: string,
  serverSpans?: readonly { type: string; value: string }[],
): CodeBlockModel {
  const language = normalizeLanguage(languageHint || "");
  return {
    language,
    lines: highlightCode(code, languageHint || "", serverSpans),
    raw: code,
  };
}

/** Whether a language is in the explicitly-supported top-N set. */
export function isSupportedLanguage(languageHint: string): boolean {
  const norm = normalizeLanguage(languageHint || "");
  return (SUPPORTED_CODE_LANGUAGES as readonly string[]).includes(norm);
}
