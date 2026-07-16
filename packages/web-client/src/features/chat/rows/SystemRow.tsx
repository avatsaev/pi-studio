/**
 * System row — muted/italic styling (POC's `turn_canceled` "(canceled)" reasoning-styled bubble,
 * POC_TO_APP_PLAN_UI.md §4.3), used for canceled-turn markers and other system notices.
 */

import type { SystemRow as SystemRowModel } from "../../../timeline/row-model.js";
import styles from "./rows.module.css";

export interface SystemRowProps {
  row: SystemRowModel;
}

export function SystemRow({ row }: SystemRowProps) {
  return <div className={`${styles.row} ${styles.system}`}>{row.text}</div>;
}
