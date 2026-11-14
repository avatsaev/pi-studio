/**
 * Shiki wrapper + lang-from-path map. Replaces the POC's CDN `highlight.js`
 * (POC_TO_APP_PLAN_UI.md §2, §4.8). Grammars/themes are loaded lazily and cached — the
 * highlighter is not paid for until a code block/file view actually renders.
 */

import { createHighlighter, type Highlighter } from "shiki";

/** POC `getLangFromPath` extension → language map, ported verbatim. */
const EXT_TO_LANG: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  jsx: "javascript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  html: "html",
  css: "css",
  scss: "scss",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  md: "markdown",
  sh: "bash",
  bash: "bash",
  sql: "sql",
  swift: "swift",
  kt: "kotlin",
  dart: "dart",
  vue: "xml",
  svelte: "xml",
};

export function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "plaintext";
}

const THEME = "github-dark";

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>(["plaintext"]);

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ themes: [THEME], langs: ["plaintext"] });
  }
  return highlighterPromise;
}

async function ensureLang(highlighter: Highlighter, lang: string): Promise<string> {
  if (loadedLangs.has(lang)) return lang;
  try {
    await highlighter.loadLanguage(lang as never);
    loadedLangs.add(lang);
    return lang;
  } catch {
    return "plaintext"; // unknown grammar to Shiki — fall back rather than throw
  }
}

/** Highlight `code` for `lang` (or a path via `langFromPath`) to sanitized HTML. */
export async function highlightToHtml(code: string, lang: string): Promise<string> {
  const highlighter = await getHighlighter();
  const resolved = await ensureLang(highlighter, lang);
  return highlighter.codeToHtml(code, { lang: resolved, theme: THEME });
}
