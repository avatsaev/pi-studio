// Markdown feature set model and streaming-safe parser.
// clean-room-scope/features/timeline-rendering.md § Markdown feature support

export type MarkdownBlockKind =
  | "heading"
  | "paragraph"
  | "code_block"
  | "inline_code"
  | "bullet_list"
  | "ordered_list"
  | "blockquote"
  | "table"
  | "image"
  | "rule"
  | "html"
  | "unknown";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type MarkdownBlock =
  | { kind: "heading"; level: HeadingLevel; text: string; id: string }
  | { kind: "paragraph"; text: string; id: string }
  | { kind: "code_block"; language: string; code: string; id: string }
  | { kind: "bullet_list"; items: string[]; id: string }
  | { kind: "ordered_list"; items: string[]; start: number; id: string }
  | { kind: "blockquote"; text: string; id: string }
  | { kind: "table"; headers: string[]; rows: string[][]; id: string }
  | { kind: "image"; alt: string; src: string; id: string }
  | { kind: "rule"; id: string }
  | { kind: "unknown"; raw: string; id: string };

export type ParsedMarkdown = {
  blocks: MarkdownBlock[];
  /** True if the last fence was not closed (streaming partial). */
  streamingFenceOpen: boolean;
};

let _idCounter = 0;
function nextId(): string { return `md-${++_idCounter}`; }

// A streaming-safe markdown parser: never throws on incomplete fences.
// This is a structural parser for block-level partitioning, not a full renderer.
export function parseMarkdownBlocks(markdown: string): ParsedMarkdown {
  const lines = markdown.split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  let streamingFenceOpen = false;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    if (/^```|^~~~/.test(line)) {
      const fence = line.slice(0, 3);
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        const l = lines[i]!;
        if (l.startsWith(fence)) { closed = true; i++; break; }
        codeLines.push(l);
        i++;
      }
      streamingFenceOpen = !closed;
      blocks.push({ kind: "code_block", language, code: codeLines.join("\n"), id: nextId() });
      continue;
    }

    // ATX heading
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      blocks.push({ kind: "heading", level: headingMatch[1]!.length as HeadingLevel, text: headingMatch[2]!, id: nextId() });
      i++; continue;
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ kind: "rule", id: nextId() });
      i++; continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const quoteLines: string[] = [line.slice(1).trim()];
      i++;
      while (i < lines.length && lines[i]!.startsWith(">")) { quoteLines.push(lines[i]!.slice(1).trim()); i++; }
      blocks.push({ kind: "blockquote", text: quoteLines.join("\n"), id: nextId() });
      continue;
    }

    // Bullet list
    if (/^[\*\-\+]\s/.test(line)) {
      const items: string[] = [line.slice(2)];
      i++;
      while (i < lines.length && /^[\*\-\+]\s/.test(lines[i]!)) { items.push(lines[i]!.slice(2)); i++; }
      blocks.push({ kind: "bullet_list", items, id: nextId() });
      continue;
    }

    // Ordered list
    const olMatch = /^(\d+)\.\s(.*)/.exec(line);
    if (olMatch) {
      const start = Number(olMatch[1]!);
      const items: string[] = [olMatch[2]!];
      i++;
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\d+\.\s/, "")); i++; }
      blocks.push({ kind: "ordered_list", items, start, id: nextId() });
      continue;
    }

    // GFM table (header row with |)
    if (line.includes("|") && i + 1 < lines.length && /^\|?[\s\-:]+\|/.test(lines[i + 1] ?? "")) {
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i]!.includes("|")) { tableLines.push(lines[i]!); i++; }
      const parsedTable = parseTable(tableLines);
      if (parsedTable) { blocks.push({ ...parsedTable, id: nextId() }); continue; }
    }

    // Image
    const imgMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim());
    if (imgMatch) {
      blocks.push({ kind: "image", alt: imgMatch[1]!, src: imgMatch[2]!, id: nextId() });
      i++; continue;
    }

    // Paragraph (collect until blank line or structural element)
    if (line.trim()) {
      const paraLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|~~~|>|[\*\-\+]\s|\d+\.\s)/.test(lines[i]!)) {
        paraLines.push(lines[i]!); i++;
      }
      blocks.push({ kind: "paragraph", text: paraLines.join("\n"), id: nextId() });
      continue;
    }

    i++; // blank line
  }
  return { blocks, streamingFenceOpen };
}

function parseTable(lines: string[]): Omit<Extract<MarkdownBlock, { kind: "table" }>, "id"> | null {
  const splitRow = (l: string) => l.split("|").map((c) => c.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const headers = splitRow(lines[0]!);
  const rows = lines.slice(2).map(splitRow);
  return { kind: "table", headers, rows };
}

// Language alias normalization per design-system spec
export const LANGUAGE_ALIASES: Record<string, string> = {
  typescript: "ts", javascript: "js", python: "py", rust: "rs", "c++": "cpp", csharp: "cs",
  golang: "go", ruby: "rb", bash: "sh", shell: "sh", kotlin: "kt", swift: "swift",
};

export function normalizeLanguage(lang: string): string {
  const lower = lang.toLowerCase().trim();
  return LANGUAGE_ALIASES[lower] ?? lower;
}

// Copy-button state
export type CopyButtonState = "idle" | "copied";

export function nextCopyState(current: CopyButtonState): { state: CopyButtonState; resetAfterMs?: number } {
  if (current === "idle") return { state: "copied", resetAfterMs: 2000 };
  return { state: "idle" };
}
