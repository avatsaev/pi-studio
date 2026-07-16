/**
 * Tool call card — icon + label + inline detail + status badge header, with an expandable body
 * (POC `.msg.tool`, POC_TO_APP_PLAN_UI.md §4.3). Collapsed by default; clicking the header reveals
 * the full detail as an ordered list of sections: input detail (`edit` diffs render through the
 * shared `<DiffView>`; shell command/path/query/url/task description render in a monospace block)
 * followed by tool output (stdout, file content, etc.), when present. Cards with no expandable
 * sections (`toolBody` → `[]`) show only the header. The virtualized timeline re-measures on
 * expand via `measureElement`, so height changes need no special handling here.
 */

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import { StatusBadge } from "../../../components/primitives/StatusBadge.js";
import { DiffView } from "../../files/DiffView.js";
import { toolIcon, toolLabel, toolInlineDetail, toolBody } from "../../../timeline/tool-mapping.js";
import type { ToolRow } from "../../../timeline/row-model.js";
import styles from "./rows.module.css";

export interface ToolCardProps {
  row: ToolRow;
}

const BADGE_VARIANT = {
  running: "muted",
  completed: "success",
  error: "error",
} as const;

export function ToolCard({ row }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = toolIcon(row.tool);
  const inlineDetail = toolInlineDetail(row.tool);
  const body = toolBody(row.tool);
  const hasBody = body.length > 0;

  return (
    <div className={clsx(styles.row, styles.tool)}>
      <button
        type="button"
        className={styles.toolHeader}
        onClick={() => hasBody && setExpanded((v) => !v)}
        aria-expanded={hasBody ? expanded : undefined}
        disabled={!hasBody}
      >
        {hasBody && (
          <ChevronRight
            size={12}
            className={clsx(styles.toolChevron, expanded && styles.toolChevronOpen)}
          />
        )}
        <span className={clsx(styles.toolIcon, styles[row.status])}>
          <Icon size={14} />
        </span>
        <span className={styles.toolLabel}>{toolLabel(row.tool)}</span>
        {inlineDetail && (
          <span className={styles.toolInlineDetail} title={inlineDetail}>
            {inlineDetail}
          </span>
        )}
        <StatusBadge className={styles.toolBadge} label={row.status} variant={BADGE_VARIANT[row.status]} />
      </button>
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
  );
}
