/**
 * Assistant message row (POC `.msg.assistant`, POC_TO_APP_PLAN_UI.md §4.3). While streaming,
 * renders plain text with a blinking cursor — re-parsing markdown on every token would be
 * wasteful (§6 Performance strategy). Once `turn_completed` finalizes the row (`streaming:
 * false`), it renders through `<Markdown>`.
 */

import type { AssistantRow as AssistantRowModel } from "@pi-studio-ui/timeline/row-model.js";
import { Markdown } from "@pi-studio-ui/timeline/markdown.js";
import styles from "./rows.module.css";

export interface AssistantRowProps {
  row: AssistantRowModel;
}

export function AssistantRow({ row }: AssistantRowProps) {
  return (
    <div className={`${styles.row} ${styles.assistant}${row.streaming ? ` ${styles.streaming}` : ""}`}>
      <span className={styles.who}>assistant</span>
      {row.streaming ? (
        <span className={styles.streamingText}>
          {row.text}
          <span className={styles.cursor}>▍</span>
        </span>
      ) : (
        <Markdown text={row.text} />
      )}
    </div>
  );
}
