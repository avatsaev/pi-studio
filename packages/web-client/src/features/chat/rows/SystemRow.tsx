/**
 * System row — centered muted marker (design spec § 04's ROW/EVENT table), used for canceled-turn
 * markers and other system notices. The one row kind that renders outside `RowShell` — it has no
 * rail entry.
 */

import type { SystemRow as SystemRowModel } from "@pi-studio-ui/timeline/row-model.js";
import styles from "./rows.module.css";

export interface SystemRowProps {
  row: SystemRowModel;
}

export function SystemRow({ row }: SystemRowProps) {
  return <div className={styles.systemRow}>{row.text}</div>;
}
