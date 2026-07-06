/**
 * ListRow — shared row for list-as-page surfaces (Sessions, Schedules).
 * Leading status/icon slot, primary title (foreground) + secondary line
 * (foregroundMuted), trailing metadata (e.g. relative time). No borders —
 * spacing + surface separate items (docs/design.md §5).
 */

import type { ReactNode } from "react";
import styles from "./ListRow.module.css";

export interface ListRowProps {
  /** Leading slot (e.g. a StatusDot). */
  lead?: ReactNode;
  title: ReactNode;
  /** Secondary muted line (host, target, path…). */
  secondary?: ReactNode;
  /** Trailing muted metadata (e.g. relative time). */
  trailing?: ReactNode;
  onClick?: () => void;
}

export function ListRow({ lead, title, secondary, trailing, onClick }: ListRowProps) {
  return (
    <div className={styles.row} onClick={onClick} role="button" tabIndex={0}>
      {lead != null && <div className={styles.lead}>{lead}</div>}
      <div className={styles.content}>
        <span className={styles.title}>{title}</span>
        {secondary != null && <span className={styles.secondary}>{secondary}</span>}
      </div>
      {trailing != null && <div className={styles.trailing}>{trailing}</div>}
    </div>
  );
}
