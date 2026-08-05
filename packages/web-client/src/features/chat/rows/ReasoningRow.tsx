/**
 * Reasoning row — dimmer/italic styling, visually distinct from assistant replies (POC
 * `.msg.reasoning`, POC_TO_APP_PLAN_UI.md §4.3). Streams as plain text with a cursor, same
 * rationale as `AssistantRow`.
 */

import type { ReasoningRow as ReasoningRowModel } from "@pi-studio-ui/timeline/row-model.js";
import { Markdown } from "@pi-studio-ui/timeline/markdown.js";
import styles from "./rows.module.css";

export interface ReasoningRowProps {
  row: ReasoningRowModel;
  owningPaneId?: string | null;
  workspaceCwd?: string | null;
}

export function ReasoningRow({ row, owningPaneId = null, workspaceCwd = null }: ReasoningRowProps) {
  return (
    <div className={`${styles.row} ${styles.reasoning}`}>
      <span className={styles.who}>thinking</span>
      {row.streaming ? (
        <span className={styles.streamingText}>
          {row.text}
          <span className={styles.cursor}>▍</span>
        </span>
      ) : (
        <Markdown text={row.text} owningPaneId={owningPaneId} workspaceCwd={workspaceCwd} />
      )}
    </div>
  );
}
