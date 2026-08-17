/**
 * Tool call card (design spec § 04, sprint-059/task-004) — a kind badge + full primary field +
 * status in the header, on the shared `RowShell` rail. Collapsed by default; clicking the header
 * reveals the full detail as an ordered list of sections: input detail (`edit` diffs render
 * through the shared `<DiffView>`; shell command/path/query/url/task description render in a
 * monospace block) followed by tool output (stdout, file content, etc.), when present. Cards with
 * no expandable sections (`toolBody` → `[]`) show only the header. The virtualized timeline
 * re-measures on expand via `measureElement`, so height changes need no special handling here.
 *
 * `cursor: pointer` alone wasn't a clear enough signal that the header is clickable (user
 * feedback); `.toolHeader:hover` now lifts the header's background (the app's existing
 * theme-adaptive `foreground`-mix hover idiom), and its own bodyless-card guard
 * (`:not([aria-disabled="true"])`) means a card with nothing to expand shows no hover feedback.
 *
 * The header is a `role="button"` `div`, not a `<button>`, because the `edit`/`write` "Open"
 * control must sit beside it as a real, independently-focusable button — nesting a `<button>`
 * inside a `<button>` is invalid HTML and breaks its own click handling. `stopPropagation` on
 * Open's own handlers keeps it from also toggling the card.
 */

import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import { Icon } from "@pi-studio-ui/components/primitives/Icon.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { DiffView, parseDiff } from "@pi-studio-ui/features/files/DiffView.js";
import { openFileTab } from "@pi-studio-ui/features/files/open-file-tab.js";
import { resolveFileOpenTarget } from "@pi-studio-ui/timeline/file-open-target.js";
import {
  toolIcon,
  toolBadge,
  toolBody,
  toolFilePath,
  toolPrimaryField,
  toolDiffStats,
  toolOutputLineCount,
} from "@pi-studio-ui/timeline/tool-mapping.js";
import type { ToolRow } from "@pi-studio-ui/timeline/row-model.js";
import { RowShell } from "./RowShell.js";
import styles from "./rows.module.css";

export interface ToolCardProps {
  row: ToolRow;
  assetBase?: string | null;
  owningPaneId?: string | null;
  workspaceCwd?: string | null;
  /** Draw the rail connector below this row. `false` on the timeline's last row. */
  connector: boolean;
}

/** First changed line of a diff plus how many more changed lines follow it — the collapsed
 * one-line teaser (design spec § 04's "+ name: …" / "… N more lines" example). Context lines
 * don't count toward "more": they're not what "changed" means to a reader skimming the card. */
function diffPreview(
  patch: string,
): { text: string; kind: "add" | "del"; moreCount: number } | null {
  const changed = parseDiff(patch).filter(
    (row): row is typeof row & { kind: "add" | "del" } => row.kind === "add" || row.kind === "del",
  );
  const first = changed[0];
  if (!first) return null;
  return { text: first.text, kind: first.kind, moreCount: changed.length - 1 };
}

function statusTrailing(row: ToolRow) {
  if (row.status === "completed") {
    return <span className={styles.toolStatusSuccess}>✓ completed</span>;
  }
  if (row.status === "error") {
    return <span className={styles.toolStatusError}>{row.statusText || "error"}</span>;
  }
  // row.status === "running": the wire's free-form statusText may carry a value other than
  // "running" itself (e.g. "awaiting_approval") that the normalized enum collapses into
  // "running" — render those as plain muted text instead of a misleading spinner.
  if (row.statusText && row.statusText !== "running") {
    return <span className={styles.toolStatusUnknown}>{row.statusText}</span>;
  }
  return (
    <span className={styles.toolStatusRunning}>
      <Spinner size="xs" color="var(--pi-color-accentBright)" />
      running
    </span>
  );
}

export function ToolCard({
  row,
  assetBase = null,
  owningPaneId = null,
  workspaceCwd = null,
  connector,
}: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const badge = toolBadge(row.tool);
  const body = toolBody(row.tool);
  const hasBody = body.length > 0;
  const outputLines = toolOutputLineCount(row.tool.output);
  const filePath =
    row.tool.kind === "edit" || row.tool.kind === "write" ? toolFilePath(row.tool) : null;
  const diffStats = row.tool.kind === "edit" ? toolDiffStats(row.tool.diff) : null;
  const preview =
    row.tool.kind === "edit" && row.tool.diff && !expanded ? diffPreview(row.tool.diff) : null;

  function toggle() {
    if (hasBody) setExpanded((v) => !v);
  }

  function handleHeaderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  }

  function handleOpen(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!filePath) return;
    const target = resolveFileOpenTarget(assetBase, owningPaneId, workspaceCwd);
    openFileTab(filePath, target.workspaceCwd, target.targetPaneId);
  }

  return (
    <RowShell
      disc={<Icon icon={toolIcon(row.tool)} size="xs" color="var(--pi-color-foregroundMuted)" />}
      discClassName={styles.toolDisc}
      connector={connector}
    >
      <div
        className={clsx(
          styles.toolCardBody,
          row.status === "running" && styles.toolCardBodyRunning,
          row.status === "error" && styles.toolCardBodyError,
        )}
      >
        <div
          role="button"
          tabIndex={hasBody ? 0 : -1}
          aria-expanded={hasBody ? expanded : undefined}
          aria-disabled={!hasBody}
          className={clsx(styles.toolHeader, row.status === "running" && styles.toolHeaderRunning)}
          onClick={toggle}
          onKeyDown={handleHeaderKeyDown}
        >
          {hasBody && (
            <ChevronRight
              size={12}
              className={clsx(styles.toolChevron, expanded && styles.toolChevronOpen)}
            />
          )}
          <span
            className={styles.kindBadge}
            style={
              { "--kindToken": `var(--pi-color-${badge.token})` } as CSSProperties & {
                "--kindToken": string;
              }
            }
          >
            {badge.label}
          </span>
          <span className={styles.toolPath} title={toolPrimaryField(row.tool)}>
            {toolPrimaryField(row.tool)}
          </span>
          <span className={styles.toolTrailing}>
            {diffStats && (diffStats.added > 0 || diffStats.removed > 0) && (
              <>
                <span className={styles.toolDiffAdded}>+{diffStats.added}</span>
                <span className={styles.toolDiffRemoved}>−{diffStats.removed}</span>
              </>
            )}
            {statusTrailing(row)}
            {filePath && (
              <button
                type="button"
                className={styles.toolOpenButton}
                onClick={handleOpen}
                onKeyDown={(event) => event.stopPropagation()}
              >
                Open
                <ArrowUpRight size={10} />
              </button>
            )}
          </span>
        </div>
        {outputLines > 0 && (
          <div className={styles.toolOutputStrip}>output · {outputLines} lines</div>
        )}
        {preview && (
          <div className={styles.toolDiffPreview}>
            <div
              className={clsx(
                styles.toolDiffPreviewLine,
                preview.kind === "add" ? styles.toolDiffPreviewAdd : styles.toolDiffPreviewDel,
              )}
            >
              {preview.text}
            </div>
            {preview.moreCount > 0 && (
              <div className={styles.toolDiffPreviewMore}>… {preview.moreCount} more lines</div>
            )}
          </div>
        )}
        {expanded && hasBody && (
          <div className={styles.toolBody}>
            {body.map((section, i) =>
              section.kind === "diff" ? (
                <DiffView key={i} patch={section.patch} />
              ) : (
                <pre key={i} className={styles.toolCode}>
                  {section.text}
                </pre>
              ),
            )}
          </div>
        )}
      </div>
    </RowShell>
  );
}
