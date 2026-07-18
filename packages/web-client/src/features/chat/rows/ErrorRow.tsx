/**
 * Error row — red-tinted block (POC `.msg.err`, POC_TO_APP_PLAN_UI.md §4.3), used for
 * `turn_failed`/`error` stream events.
 */

import type { ErrorRow as ErrorRowModel } from "@pi-studio-ui/timeline/row-model.js";
import styles from "./rows.module.css";

export interface ErrorRowProps {
  row: ErrorRowModel;
}

export function ErrorRow({ row }: ErrorRowProps) {
  return (
    <div className={`${styles.row} ${styles.error}`}>
      <span className={styles.who}>error</span>
      {row.text}
    </div>
  );
}
