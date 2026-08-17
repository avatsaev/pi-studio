/**
 * Splits a still-growing assistant/reasoning message into **immutable leading blocks** plus the
 * **one block the model is currently writing** (`tail`), so a streaming row can render markdown
 * live without re-parsing the whole message on every token delta.
 *
 * Why this exists: the daemon emits one `assistant_message` per Pi `text_delta`
 * (`event-mapper.ts`), each one applied straight to the session store, so the streaming row
 * re-renders per token. Parsing the full text through react-markdown + remark-gfm + remark-math +
 * rehype-katex costs ~9ms at 3.5KB and ~27ms at 10KB (measured), which is several frame budgets
 * per token. Every block *before* the one being written can no longer change, so it is parsed
 * exactly once (`Markdown`'s memoized body, keyed on the block string) and the recurring per-token
 * cost collapses to one short tail parse (~0.24ms).
 *
 * A boundary is only cut where re-parsing the two sides independently cannot change how either
 * renders. The rules are deliberately conservative — a wrong cut is a visible mid-stream artifact:
 *
 * - **Blank line at fence depth 0.** Inside a ``` / ~~~ fence or a `$$` math block a blank line is
 *   content, not a separator — cutting there would hand a half-open fence to Shiki and a half-typed
 *   expression to KaTeX. Those constructs stay whole in the tail until they close.
 * - **The next non-empty line must start in column 0.** An indented line after a blank line is a
 *   list item's second paragraph (or an indented code block); parsed on its own it would render as
 *   a gray code box.
 * - **Never between two list blocks.** `- a\n\n- b` is one loose list; cutting it would render two
 *   `<ul>`s with different spacing.
 * - **After a column-0 closing fence.** A fenced block is a leaf — nothing following it can change
 *   it — so a code block highlights the moment it closes instead of waiting for a blank line.
 * - **The next block's first line must have arrived.** A trailing blank line alone never cuts: the
 *   next chunk could be an indented continuation, and committing the block early would strand that
 *   continuation as its own (code-block) block for the rest of the turn. The wait is one token.
 *
 * What is *not* preserved across a cut: link reference definitions (`[x]: url` in an earlier block
 * used by the tail) and setext headings straddling a boundary. Both self-heal, because a finalized
 * row leaves this path entirely and renders as one canonical parse of the whole text.
 */

export interface StreamingMarkdownSplit {
  /** Blocks that can no longer grow, in order. Append-only across deltas — index keys are stable. */
  blocks: string[];
  /** The block still being written (possibly empty). Never contains a completed block. */
  tail: string;
}

/** Bullet or ordered list item, at CommonMark's ≤3-space indent. */
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;

/** An opening/closing fence: ≥3 backticks or tildes, capturing indent and marker run. */
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;

function isListBlock(lines: string[]): boolean {
  return LIST_ITEM.test(lines[0] ?? "");
}

/** Index of the next line with content, or -1 when only blank lines remain. */
function nextNonEmptyLine(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() !== "") return i;
  }
  return -1;
}

export function splitStreamingMarkdown(text: string): StreamingMarkdownSplit {
  if (!text) return { blocks: [], tail: "" };

  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  /** Closing-fence matcher for the open fence (same marker char, at least as long), or null. */
  let fenceClose: RegExp | null = null;
  /** Whether the open fence started in column 0 — an indented fence belongs to a list item. */
  let fenceAtColumn0 = false;
  let inMathBlock = false;

  const cut = (): void => {
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (fenceClose !== null) {
      current.push(line);
      if (fenceClose.test(trimmed)) {
        const wasAtColumn0 = fenceAtColumn0;
        fenceClose = null;
        fenceAtColumn0 = false;
        if (wasAtColumn0) cut();
      }
      continue;
    }

    const fenceMatch = FENCE.exec(line);
    if (fenceMatch && !inMathBlock) {
      const marker = fenceMatch[2]!;
      fenceClose = new RegExp(`^[${marker[0]}]{${marker.length},}$`);
      fenceAtColumn0 = fenceMatch[1] === "";
      current.push(line);
      continue;
    }

    // Leading blank lines carry no meaning at a block start — dropping them keeps the separator
    // out of the next block (a cut after a closing fence lands right before one).
    if (trimmed === "" && current.length === 0) continue;

    // A line with an odd number of `$$` opens or closes block math (`$$x$$` on one line is even).
    const mathDelimiters = trimmed.split("$$").length - 1;
    if (mathDelimiters % 2 === 1) inMathBlock = !inMathBlock;

    if (trimmed === "" && !inMathBlock) {
      const next = nextNonEmptyLine(lines, i + 1);
      const nextLine = next === -1 ? null : (lines[next] ?? "");
      const startsInColumn0 = nextLine !== null && !/^\s/.test(nextLine);
      const joinsList = nextLine !== null && LIST_ITEM.test(nextLine) && isListBlock(current);
      if (startsInColumn0 && !joinsList) {
        cut();
        i = next - 1; // resume at the next block's first line, dropping the separator blanks
        continue;
      }
    }

    current.push(line);
  }

  return { blocks, tail: current.join("\n") };
}
