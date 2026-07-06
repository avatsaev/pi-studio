// Production diff-viewer model: unified & split (side-by-side) rows, word-level
// diff highlighting, collapsed unchanged ranges, binary/too-large placeholders,
// scroll-to-change navigation, and copy-hunk text.
//
// clean-room-scope/features/feature-panels-ui.md § Git: changes / diff
// clean-room-scope/features/git-checkout.md § diff rendering

export type DiffLineKind = "context" | "added" | "removed";

export interface DiffInputLine {
  kind: DiffLineKind;
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface DiffInputHunk {
  header: string;
  lines: DiffInputLine[];
}

export interface DiffInput {
  filePath: string;
  hunks: DiffInputHunk[];
  isBinary?: boolean;
  tooLarge?: boolean;
  /** Raw byte size, used for the too-large placeholder + auto-detection. */
  byteSize?: number;
  /** File change kind, carried through from the git diff projection. */
  kind?: "added" | "deleted" | "modified" | "renamed" | "copied";
}

/** Files larger than this are gated behind a "Show anyway" affordance. */
export const TOO_LARGE_BYTES = 500 * 1024;

// ─── Word-level diff ─────────────────────────────────────────────────────────

export type WordSegmentType = "equal" | "add" | "remove";
export interface WordSegment {
  type: WordSegmentType;
  value: string;
}

/** Tokenize into words + separators so whitespace/punctuation align naturally. */
export function tokenizeWords(text: string): string[] {
  return text.match(/(\w+|\s+|[^\w\s]+)/g) ?? [];
}

/**
 * Word-level diff between an old and a new line. Returns the segment stream for
 * each side: the old side carries equal + remove segments; the new side carries
 * equal + add segments. Uses an LCS over word tokens.
 */
export function computeWordDiff(
  oldLine: string,
  newLine: string,
): { old: WordSegment[]; new: WordSegment[] } {
  const a = tokenizeWords(oldLine);
  const b = tokenizeWords(newLine);
  const lcs = lcsMatrix(a, b);

  const oldSegs: WordSegment[] = [];
  const newSegs: WordSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pushSeg(oldSegs, "equal", a[i]!);
      pushSeg(newSegs, "equal", b[j]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      pushSeg(oldSegs, "remove", a[i]!);
      i++;
    } else {
      pushSeg(newSegs, "add", b[j]!);
      j++;
    }
  }
  while (i < a.length) pushSeg(oldSegs, "remove", a[i++]!);
  while (j < b.length) pushSeg(newSegs, "add", b[j++]!);
  return { old: oldSegs, new: newSegs };
}

function pushSeg(segs: WordSegment[], type: WordSegmentType, value: string): void {
  const last = segs[segs.length - 1];
  if (last && last.type === type) last.value += value;
  else segs.push({ type, value });
}

function lcsMatrix(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  return dp;
}

// ─── Change-block pairing (for word diff) ─────────────────────────────────────

interface ChangeBlock {
  removed: DiffInputLine[];
  added: DiffInputLine[];
}

/**
 * Attach word-level segments to a removed/added pair when the two lines are
 * "similar enough" (share a common prefix or a reasonable token overlap),
 * otherwise leave them as whole-line changes.
 */
function pairWordDiff(block: ChangeBlock): Map<DiffInputLine, WordSegment[]> {
  const map = new Map<DiffInputLine, WordSegment[]>();
  const pairs = Math.min(block.removed.length, block.added.length);
  for (let k = 0; k < pairs; k++) {
    const oldLine = block.removed[k]!;
    const newLine = block.added[k]!;
    const wd = computeWordDiff(oldLine.content, newLine.content);
    // Only annotate if there is a meaningful shared portion.
    if (wd.old.some((s) => s.type === "equal" && s.value.trim().length > 0)) {
      map.set(oldLine, wd.old);
      map.set(newLine, wd.new);
    }
  }
  return map;
}

// ─── Unified rows ──────────────────────────────────────────────────────────

export type UnifiedRow =
  | { type: "hunk-header"; hunkIndex: number; header: string }
  | { type: "collapsed"; hiddenCount: number; hunkIndex: number }
  | {
      type: "line";
      kind: DiffLineKind;
      content: string;
      oldLineNo?: number;
      newLineNo?: number;
      wordSegments?: WordSegment[];
      hunkIndex: number;
      /** True when this row represents a change (add/remove) — for scroll-to-change. */
      isChange: boolean;
    };

export interface DiffRowOptions {
  /** Collapse runs of unchanged context longer than this. 0 disables. */
  collapseContext?: number;
  /** Context lines to keep visible on each edge of a collapsed run. */
  contextEdge?: number;
}

const DEFAULT_COLLAPSE = 6;
const DEFAULT_EDGE = 3;

export function buildUnifiedRows(input: DiffInput, options: DiffRowOptions = {}): UnifiedRow[] {
  const collapse = options.collapseContext ?? DEFAULT_COLLAPSE;
  const edge = options.contextEdge ?? DEFAULT_EDGE;
  const rows: UnifiedRow[] = [];

  input.hunks.forEach((hunk, hunkIndex) => {
    rows.push({ type: "hunk-header", hunkIndex, header: hunk.header });
    const wordMap = wordMapForHunk(hunk);

    // Group into runs so long context runs can collapse.
    const emitted = collapseRuns(hunk.lines, collapse, edge);
    for (const item of emitted) {
      if (item.collapsed) {
        rows.push({ type: "collapsed", hiddenCount: item.hiddenCount, hunkIndex });
        continue;
      }
      const line = item.line!;
      rows.push({
        type: "line",
        kind: line.kind,
        content: line.content,
        oldLineNo: line.oldLineNo,
        newLineNo: line.newLineNo,
        wordSegments: wordMap.get(line),
        hunkIndex,
        isChange: line.kind !== "context",
      });
    }
  });

  return rows;
}

// ─── Split rows ──────────────────────────────────────────────────────────────

export interface SplitCell {
  kind: DiffLineKind | "blank";
  content: string;
  lineNo?: number;
  wordSegments?: WordSegment[];
}

export type SplitRow =
  | { type: "hunk-header"; hunkIndex: number; header: string }
  | { type: "collapsed"; hiddenCount: number; hunkIndex: number }
  | { type: "line"; left: SplitCell; right: SplitCell; hunkIndex: number; isChange: boolean };

export function buildSplitRows(input: DiffInput, options: DiffRowOptions = {}): SplitRow[] {
  const collapse = options.collapseContext ?? DEFAULT_COLLAPSE;
  const edge = options.contextEdge ?? DEFAULT_EDGE;
  const rows: SplitRow[] = [];

  input.hunks.forEach((hunk, hunkIndex) => {
    rows.push({ type: "hunk-header", hunkIndex, header: hunk.header });
    const wordMap = wordMapForHunk(hunk);

    // Walk lines, grouping consecutive removed/added into change blocks so we
    // can align them side-by-side.
    const lines = hunk.lines;
    let idx = 0;
    // Track visible/collapsed via the same run detection on context lines.
    const collapsedFlags = collapseFlags(lines, collapse, edge);

    while (idx < lines.length) {
      const line = lines[idx]!;
      if (collapsedFlags.hiddenAt.has(idx)) {
        // Emit a single collapsed marker for the run, skip the rest of the run.
        const run = collapsedFlags.hiddenAt.get(idx)!;
        rows.push({ type: "collapsed", hiddenCount: run, hunkIndex });
        idx += run;
        continue;
      }
      if (line.kind === "context") {
        rows.push({
          type: "line",
          left: { kind: "context", content: line.content, lineNo: line.oldLineNo },
          right: { kind: "context", content: line.content, lineNo: line.newLineNo },
          hunkIndex,
          isChange: false,
        });
        idx++;
        continue;
      }
      // Collect a change block.
      const removed: DiffInputLine[] = [];
      const added: DiffInputLine[] = [];
      while (idx < lines.length && lines[idx]!.kind === "removed") removed.push(lines[idx++]!);
      while (idx < lines.length && lines[idx]!.kind === "added") added.push(lines[idx++]!);
      const pairCount = Math.max(removed.length, added.length);
      for (let k = 0; k < pairCount; k++) {
        const l = removed[k];
        const r = added[k];
        rows.push({
          type: "line",
          left: l
            ? { kind: "removed", content: l.content, lineNo: l.oldLineNo, wordSegments: wordMap.get(l) }
            : { kind: "blank", content: "" },
          right: r
            ? { kind: "added", content: r.content, lineNo: r.newLineNo, wordSegments: wordMap.get(r) }
            : { kind: "blank", content: "" },
          hunkIndex,
          isChange: true,
        });
      }
    }
  });

  return rows;
}

function wordMapForHunk(hunk: DiffInputHunk): Map<DiffInputLine, WordSegment[]> {
  const combined = new Map<DiffInputLine, WordSegment[]>();
  const lines = hunk.lines;
  let idx = 0;
  while (idx < lines.length) {
    if (lines[idx]!.kind === "removed" || lines[idx]!.kind === "added") {
      const removed: DiffInputLine[] = [];
      const added: DiffInputLine[] = [];
      while (idx < lines.length && lines[idx]!.kind === "removed") removed.push(lines[idx++]!);
      while (idx < lines.length && lines[idx]!.kind === "added") added.push(lines[idx++]!);
      const map = pairWordDiff({ removed, added });
      for (const [k, v] of map) combined.set(k, v);
    } else {
      idx++;
    }
  }
  return combined;
}

// ─── Collapsed-context helpers ─────────────────────────────────────────────

interface CollapseItem {
  collapsed: boolean;
  hiddenCount: number;
  line?: DiffInputLine;
}

/**
 * Turn a line list into a flat emission list where long runs of context lines
 * are collapsed to `edge` visible lines on each side + a single collapsed marker.
 */
function collapseRuns(lines: DiffInputLine[], collapse: number, edge: number): CollapseItem[] {
  if (collapse <= 0) return lines.map((line) => ({ collapsed: false, hiddenCount: 0, line }));
  const out: CollapseItem[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== "context") {
      out.push({ collapsed: false, hiddenCount: 0, line: lines[i]! });
      i++;
      continue;
    }
    // Measure the context run.
    let j = i;
    while (j < lines.length && lines[j]!.kind === "context") j++;
    const runLen = j - i;
    const isEdgeRun = i === 0 || j === lines.length; // leading/trailing run
    const keep = isEdgeRun ? edge : edge * 2;
    if (runLen > collapse && runLen > keep) {
      if (i === 0) {
        // Leading run: hide the top, keep the bottom `edge`.
        out.push({ collapsed: true, hiddenCount: runLen - edge, line: undefined });
        for (let k = j - edge; k < j; k++) out.push({ collapsed: false, hiddenCount: 0, line: lines[k]! });
      } else if (j === lines.length) {
        for (let k = i; k < i + edge; k++) out.push({ collapsed: false, hiddenCount: 0, line: lines[k]! });
        out.push({ collapsed: true, hiddenCount: runLen - edge, line: undefined });
      } else {
        for (let k = i; k < i + edge; k++) out.push({ collapsed: false, hiddenCount: 0, line: lines[k]! });
        out.push({ collapsed: true, hiddenCount: runLen - edge * 2, line: undefined });
        for (let k = j - edge; k < j; k++) out.push({ collapsed: false, hiddenCount: 0, line: lines[k]! });
      }
    } else {
      for (let k = i; k < j; k++) out.push({ collapsed: false, hiddenCount: 0, line: lines[k]! });
    }
    i = j;
  }
  return out;
}

/** Split-layout variant: map the start index of each hidden run → its length. */
function collapseFlags(
  lines: DiffInputLine[],
  collapse: number,
  edge: number,
): { hiddenAt: Map<number, number> } {
  const hiddenAt = new Map<number, number>();
  if (collapse <= 0) return { hiddenAt };
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== "context") {
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j]!.kind === "context") j++;
    const runLen = j - i;
    const isEdgeRun = i === 0 || j === lines.length;
    const keep = isEdgeRun ? edge : edge * 2;
    if (runLen > collapse && runLen > keep) {
      if (i === 0) hiddenAt.set(i, runLen - edge);
      else if (j === lines.length) hiddenAt.set(i + edge, runLen - edge);
      else hiddenAt.set(i + edge, runLen - edge * 2);
    }
    i = j;
  }
  return { hiddenAt };
}

// ─── Placeholders ──────────────────────────────────────────────────────────

export type DiffPlaceholderKind = "binary" | "too_large" | null;

export interface DiffPlaceholder {
  kind: DiffPlaceholderKind;
  label: string;
  /** Only set for too_large: allow the user to force-render. */
  canShowAnyway: boolean;
}

export function diffPlaceholder(input: DiffInput, forceShow = false): DiffPlaceholder {
  if (input.isBinary) {
    const size = input.byteSize != null ? `, ${formatBytes(input.byteSize)}` : "";
    return { kind: "binary", label: `Binary file${size}`, canShowAnyway: false };
  }
  const tooLarge = input.tooLarge || (input.byteSize != null && input.byteSize > TOO_LARGE_BYTES);
  if (tooLarge && !forceShow) {
    return { kind: "too_large", label: "File too large to diff", canShowAnyway: true };
  }
  return { kind: null, label: "", canShowAnyway: false };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104857.6) / 10} MB`;
}

// ─── Scroll-to-change navigation ───────────────────────────────────────────

/** Row indices that represent a change, for next/prev navigation. */
export function changeRowIndices(rows: readonly { isChange?: boolean; type?: string }[]): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => {
    if (r.type === "line" && r.isChange) out.push(i);
  });
  return out;
}

/** Compute the next change row index after `current`, wrapping around. */
export function nextChangeIndex(changes: readonly number[], current: number): number | null {
  if (changes.length === 0) return null;
  for (const idx of changes) if (idx > current) return idx;
  return changes[0]!; // wrap
}

export function prevChangeIndex(changes: readonly number[], current: number): number | null {
  if (changes.length === 0) return null;
  for (let k = changes.length - 1; k >= 0; k--) if (changes[k]! < current) return changes[k]!;
  return changes[changes.length - 1]!; // wrap
}

// ─── Copy hunk ─────────────────────────────────────────────────────────────

/** Reconstruct a unified-diff text block for a single hunk (for clipboard). */
export function hunkToText(hunk: DiffInputHunk): string {
  const body = hunk.lines.map((l) => {
    const prefix = l.kind === "added" ? "+" : l.kind === "removed" ? "-" : " ";
    return `${prefix}${l.content}`;
  });
  return [hunk.header, ...body].join("\n");
}
