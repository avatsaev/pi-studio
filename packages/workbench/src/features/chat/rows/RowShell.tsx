/**
 * RowShell — shared `[rail | content]` scaffold for timeline rows (design spec § 04): a 20px rail
 * column holding an 18px disc and a connector line down to the next row, beside a full-width
 * content column with an optional meta line above the row's own content.
 *
 * `SystemRow` is the one row kind that renders outside this shell entirely — it has no rail entry
 * (design spec § 04's ROW/EVENT table).
 *
 * The connector is passed explicitly per row (`connector={false}` on the timeline's last row)
 * rather than inferred with a `:last-child` CSS selector, which is wrong under virtualization —
 * the last *mounted* row is not necessarily the last row in the timeline (`Timeline.tsx`'s
 * `renderRow` computes it from the row's absolute index against `rows.length`, not from what
 * happens to be mounted).
 *
 * `meta`/`metaTrailing` exist for `UserRow`/`AssistantRow`/`ReasoningRow` (sprint-059/task-003),
 * which render a label + optional trailing chip (e.g. the `final` chip) above their content; this
 * task's own consumers (`ErrorRow`) don't need one.
 */

import type { ReactNode } from "react";
import { clsx } from "clsx";
import styles from "./RowShell.module.css";

export interface RowShellProps {
  /** Disc content — typically an `Icon`. RowShell only sets the disc's shape/size; the caller
   * supplies its background/foreground tint via `discClassName`. */
  disc: ReactNode;
  discClassName?: string;
  /** Draw the connector below this row's disc. `false` on the timeline's last row. */
  connector: boolean;
  /** Meta line label (e.g. "You", "Reasoning"), rendered above `children`. Plain string, or a
   * fragment combining the label with a dimmed/hover-reveal timestamp span (`.metaTime`). */
  meta?: ReactNode;
  /** Optional trailing content on the meta line (e.g. the `final` chip). Ignored without `meta`. */
  metaTrailing?: ReactNode;
  /** Extra class on the content column, for row-kind-specific styling. */
  className?: string;
  children: ReactNode;
}

export function RowShell({
  disc,
  discClassName,
  connector,
  meta,
  metaTrailing,
  className,
  children,
}: RowShellProps) {
  return (
    <div className={styles.shellRow}>
      <div className={styles.rail}>
        <span className={clsx(styles.disc, discClassName)}>{disc}</span>
        {connector && <span className={styles.connector} />}
      </div>
      <div className={clsx(styles.content, className)}>
        {meta && (
          <div className={styles.metaLine}>
            {meta}
            {metaTrailing}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
