/**
 * Compaction row (sprint-074) — a full-width divider with a centered label that updates in place
 * from `Compacting context…` to its outcome. Like `SystemRow` it renders outside `RowShell`: it is
 * a marker in the timeline, not a speaker, so it has no rail disc, no actions, and no fork
 * affordance. A completed row with a summary discloses it (collapsed by default) through the same
 * markdown renderer assistant text uses.
 */

import { useState } from "react";
import { clsx } from "clsx";
import { ChevronRight, CircleAlert } from "lucide-react";
import { Icon } from "@pi-studio-ui/components/primitives/Icon.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { compactionLabel } from "@pi-studio-ui/timeline/compaction.js";
import { Markdown } from "@pi-studio-ui/timeline/markdown.js";
import type { CompactionRow as CompactionRowModel } from "@pi-studio-ui/timeline/row-model.js";
import styles from "./rows.module.css";

export interface CompactionRowProps {
  row: CompactionRowModel;
  assetBase?: string | null;
  owningPaneId?: string | null;
  workspaceCwd?: string | null;
}

export function CompactionRow({
  row,
  assetBase = null,
  owningPaneId = null,
  workspaceCwd = null,
}: CompactionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const label = compactionLabel(row);
  const canExpand = row.phase === "completed" && Boolean(row.summary);

  const text = <span className={styles.compactionText}>{label}</span>;
  return (
    <div
      className={clsx(styles.compactionRow, row.phase === "failed" && styles.compactionRowFailed)}
    >
      <div className={styles.compactionDivider}>
        <span className={styles.compactionRule} aria-hidden="true" />
        <span className={styles.compactionLabel}>
          {row.phase === "started" && <Spinner size="xs" aria-label="Compacting context" />}
          {row.phase === "failed" && (
            <Icon icon={CircleAlert} size="xs" color="var(--pi-color-statusDanger)" />
          )}
          {canExpand ? (
            <button
              type="button"
              className={styles.compactionToggle}
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
            >
              <ChevronRight
                size={12}
                className={clsx(styles.toolChevron, expanded && styles.toolChevronOpen)}
              />
              {text}
            </button>
          ) : (
            text
          )}
        </span>
        <span className={styles.compactionRule} aria-hidden="true" />
      </div>
      {canExpand && expanded && (
        <div className={styles.compactionSummary}>
          <Markdown
            text={row.summary!}
            assetBase={assetBase}
            owningPaneId={owningPaneId}
            workspaceCwd={workspaceCwd}
          />
        </div>
      )}
    </div>
  );
}
