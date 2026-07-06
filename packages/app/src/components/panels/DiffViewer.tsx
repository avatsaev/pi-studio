/**
 * DiffViewer — production diff renderer: unified + split (side-by-side) modes
 * with syntax highlighting, word-level highlighting, collapsed unchanged
 * ranges, binary/too-large placeholders, scroll-to-change, and copy-hunk.
 *
 * feature-panels-ui.md § Git: diff body
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, WrapText } from "lucide-react";
import { clsx } from "clsx";
import styles from "./DiffViewer.module.css";
import {
  buildUnifiedRows,
  buildSplitRows,
  diffPlaceholder,
  changeRowIndices,
  nextChangeIndex,
  prevChangeIndex,
  hunkToText,
  type DiffInput,
  type UnifiedRow,
  type SplitRow,
  type SplitCell,
  type WordSegment,
} from "../../panels/diff-viewer.js";
import { highlightCode, tokenColorVar } from "../../timeline/syntax-highlight.js";

export type DiffLayout = "unified" | "split";

export interface DiffViewerProps {
  diff: DiffInput;
  layout?: DiffLayout;
  /** Language hint for syntax highlighting (defaults to file extension). */
  language?: string;
  wrap?: boolean;
  onCopyHunk?: (text: string) => void;
}

export function DiffViewer({ diff, layout = "unified", language, wrap = false, onCopyHunk }: DiffViewerProps) {
  const [forceShow, setForceShow] = useState(false);
  const [wrapLines, setWrapLines] = useState(wrap);
  const [currentChange, setCurrentChange] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const lang = language ?? extToLang(diff.filePath);
  const placeholder = useMemo(() => diffPlaceholder(diff, forceShow), [diff, forceShow]);

  const unifiedRows = useMemo(
    () => (layout === "unified" && !placeholder.kind ? buildUnifiedRows(diff) : []),
    [diff, layout, placeholder.kind],
  );
  const splitRows = useMemo(
    () => (layout === "split" && !placeholder.kind ? buildSplitRows(diff) : []),
    [diff, layout, placeholder.kind],
  );

  const changes = useMemo(
    () => changeRowIndices(layout === "unified" ? unifiedRows : splitRows),
    [layout, unifiedRows, splitRows],
  );

  const scrollToRow = useCallback((rowIndex: number) => {
    const el = rowRefs.current.get(rowIndex);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const goNext = useCallback(() => {
    const next = nextChangeIndex(changes, currentChange);
    if (next != null) {
      setCurrentChange(next);
      scrollToRow(next);
    }
  }, [changes, currentChange, scrollToRow]);

  const goPrev = useCallback(() => {
    const prev = prevChangeIndex(changes, currentChange);
    if (prev != null) {
      setCurrentChange(prev);
      scrollToRow(prev);
    }
  }, [changes, currentChange, scrollToRow]);

  const copyHunk = useCallback(
    (hunkIndex: number) => {
      const hunk = diff.hunks[hunkIndex];
      if (!hunk) return;
      const text = hunkToText(hunk);
      onCopyHunk?.(text);
      void navigator.clipboard?.writeText(text);
    },
    [diff.hunks, onCopyHunk],
  );

  if (placeholder.kind) {
    return (
      <div className={styles.placeholder}>
        <span>{placeholder.label}</span>
        {placeholder.canShowAnyway && (
          <button className={styles.showAnyway} onClick={() => setForceShow(true)}>
            Show anyway
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.viewer}>
      <div className={styles.diffToolbar}>
        <button className={styles.iconBtn} onClick={goPrev} title="Previous change" disabled={changes.length === 0}>
          <ChevronUp size={12} />
        </button>
        <button className={styles.iconBtn} onClick={goNext} title="Next change" disabled={changes.length === 0}>
          <ChevronDown size={12} />
        </button>
        <span className={styles.changeCount}>{changes.length} changes</span>
        <button
          className={clsx(styles.iconBtn, wrapLines && styles.iconBtnActive)}
          onClick={() => setWrapLines((w) => !w)}
          title="Wrap lines"
        >
          <WrapText size={12} />
        </button>
      </div>

      <div className={styles.scroll} ref={scrollRef}>
        {layout === "unified"
          ? unifiedRows.map((row, i) => (
              <UnifiedRowView
                key={i}
                row={row}
                lang={lang}
                wrap={wrapLines}
                active={i === currentChange}
                onCopyHunk={copyHunk}
                registerRef={(el) => registerRef(rowRefs, i, el)}
              />
            ))
          : splitRows.map((row, i) => (
              <SplitRowView
                key={i}
                row={row}
                lang={lang}
                wrap={wrapLines}
                active={i === currentChange}
                onCopyHunk={copyHunk}
                registerRef={(el) => registerRef(rowRefs, i, el)}
              />
            ))}
      </div>
    </div>
  );
}

function registerRef(map: React.RefObject<Map<number, HTMLDivElement>>, index: number, el: HTMLDivElement | null) {
  if (!map.current) return;
  if (el) map.current.set(index, el);
  else map.current.delete(index);
}

// ─── Unified row ─────────────────────────────────────────────────────────────

function UnifiedRowView({
  row,
  lang,
  wrap,
  active,
  onCopyHunk,
  registerRef: reg,
}: {
  row: UnifiedRow;
  lang: string;
  wrap: boolean;
  active: boolean;
  onCopyHunk: (hunkIndex: number) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}) {
  if (row.type === "hunk-header") {
    return (
      <div className={styles.hunkHeader} ref={reg}>
        <span className={styles.hunkHeaderText}>{row.header}</span>
        <button className={styles.copyHunkBtn} onClick={() => onCopyHunk(row.hunkIndex)} title="Copy hunk">
          <Copy size={11} />
        </button>
      </div>
    );
  }
  if (row.type === "collapsed") {
    return <div className={styles.collapsed} ref={reg}>··· {row.hiddenCount} lines hidden ···</div>;
  }
  return (
    <div
      className={clsx(styles.line, styles[`line_${row.kind}`], active && styles.lineActive, wrap && styles.wrap)}
      ref={reg}
    >
      <span className={styles.gutter}>{row.oldLineNo ?? ""}</span>
      <span className={styles.gutter}>{row.newLineNo ?? ""}</span>
      <span className={styles.sign}>{row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " "}</span>
      <code className={styles.code}>
        <LineContent content={row.content} lang={lang} wordSegments={row.wordSegments} kind={row.kind} />
      </code>
    </div>
  );
}

// ─── Split row ─────────────────────────────────────────────────────────────

function SplitRowView({
  row,
  lang,
  wrap,
  active,
  onCopyHunk,
  registerRef: reg,
}: {
  row: SplitRow;
  lang: string;
  wrap: boolean;
  active: boolean;
  onCopyHunk: (hunkIndex: number) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}) {
  if (row.type === "hunk-header") {
    return (
      <div className={styles.hunkHeader} ref={reg}>
        <span className={styles.hunkHeaderText}>{row.header}</span>
        <button className={styles.copyHunkBtn} onClick={() => onCopyHunk(row.hunkIndex)} title="Copy hunk">
          <Copy size={11} />
        </button>
      </div>
    );
  }
  if (row.type === "collapsed") {
    return <div className={styles.collapsed} ref={reg}>··· {row.hiddenCount} lines hidden ···</div>;
  }
  return (
    <div className={clsx(styles.splitLine, active && styles.lineActive, wrap && styles.wrap)} ref={reg}>
      <SplitCellView cell={row.left} lang={lang} side="old" />
      <div className={styles.splitDivider} />
      <SplitCellView cell={row.right} lang={lang} side="new" />
    </div>
  );
}

function SplitCellView({ cell, lang, side }: { cell: SplitCell; lang: string; side: "old" | "new" }) {
  return (
    <div className={clsx(styles.splitCell, styles[`line_${cell.kind}`])}>
      <span className={styles.gutter}>{cell.lineNo ?? ""}</span>
      <code className={styles.code}>
        {cell.kind === "blank" ? (
          ""
        ) : (
          <LineContent content={cell.content} lang={lang} wordSegments={cell.wordSegments} kind={cell.kind} />
        )}
      </code>
    </div>
  );
}

// ─── Line content: word-diff overlay OR syntax highlighting ──────────────────

function LineContent({
  content,
  lang,
  wordSegments,
  kind,
}: {
  content: string;
  lang: string;
  wordSegments?: WordSegment[];
  kind: "context" | "added" | "removed";
}) {
  // Word-level highlighting wins on changed lines that have segments.
  if (wordSegments && wordSegments.length > 0) {
    return (
      <>
        {wordSegments.map((seg, i) => (
          <span
            key={i}
            className={clsx(
              seg.type === "add" && styles.wordAdd,
              seg.type === "remove" && styles.wordRemove,
            )}
          >
            {seg.value}
          </span>
        ))}
      </>
    );
  }
  // Otherwise syntax-highlight the line.
  const spans = highlightCode(content, lang)[0]?.spans ?? [{ type: "text", value: content }];
  return (
    <>
      {spans.map((span, i) => (
        <span key={i} style={{ color: tokenColorVar(span.type) }}>
          {span.value}
        </span>
      ))}
    </>
  );
}

function extToLang(filePath: string): string {
  const ext = filePath.split(".").pop() ?? "";
  return ext;
}
