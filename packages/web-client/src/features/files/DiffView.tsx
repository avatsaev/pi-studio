/**
 * DiffView — parsed unified-diff renderer (POC `renderDiffHtml`, chat.html ~line 959-971,
 * POC_TO_APP_PLAN_UI.md §4.5). Ported into a typed `parseDiff` + a React component — no
 * `dangerouslySetInnerHTML`/`innerHTML`, unlike the POC.
 */

import { clsx } from "clsx";
import styles from "./DiffView.module.css";

export type DiffRowKind = "hunk-header" | "add" | "del" | "ctx";

export interface DiffRow {
  kind: DiffRowKind;
  text: string;
  lineNumber?: number;
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parse a unified-diff patch string into typed rows (POC `renderDiffHtml`, ported verbatim). */
export function parseDiff(patch: string): DiffRow[] {
  const lines = patch.split("\n");
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      rows.push({ kind: "hunk-header", text: line });
      continue;
    }
    if (line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }
    if (line.startsWith("@@")) {
      const m = HUNK_HEADER_RE.exec(line);
      if (m) {
        const oldStart = m[1];
        const newStart = m[2];
        oldLine = (oldStart ? parseInt(oldStart, 10) : 1) - 1;
        newLine = (newStart ? parseInt(newStart, 10) : 1) - 1;
      }
      rows.push({ kind: "hunk-header", text: line });
      continue;
    }
    if (line.startsWith("+")) {
      newLine++;
      rows.push({ kind: "add", text: line, lineNumber: newLine });
    } else if (line.startsWith("-")) {
      oldLine++;
      rows.push({ kind: "del", text: line, lineNumber: oldLine });
    } else {
      oldLine++;
      newLine++;
      rows.push({ kind: "ctx", text: line, lineNumber: newLine });
    }
  }

  return rows;
}

export interface DiffViewProps {
  patch: string;
}

export function DiffView({ patch }: DiffViewProps) {
  const rows = parseDiff(patch);

  return (
    <div className={styles.diffView}>
      {rows.map((row, i) =>
        row.kind === "hunk-header" ? (
          <div key={i} className={styles.hunkHeader}>
            {row.text}
          </div>
        ) : (
          <div key={i} className={clsx(styles.line, styles[row.kind])}>
            <span className={styles.ln}>{row.lineNumber ?? ""}</span>
            {row.text}
          </div>
        ),
      )}
    </div>
  );
}
