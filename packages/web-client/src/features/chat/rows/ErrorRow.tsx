/**
 * Error row — inline destructive-tinted card (design spec § 04), used for `turn_failed`/`error`
 * stream events. Explicitly non-terminal: the timeline continues normally below it, so this is a
 * bordered card wash rather than the old solid-fill block, which read as an end state.
 */

import { CircleAlert } from "lucide-react";
import { Icon } from "@pi-studio-ui/components/primitives/Icon.js";
import type { ErrorRow as ErrorRowModel } from "@pi-studio-ui/timeline/row-model.js";
import { RowShell } from "./RowShell.js";
import styles from "./rows.module.css";

export interface ErrorRowProps {
  row: ErrorRowModel;
  /** Draw the rail connector below this row. `false` on the timeline's last row. */
  connector: boolean;
}

export function ErrorRow({ row, connector }: ErrorRowProps) {
  return (
    <RowShell
      disc={<Icon icon={CircleAlert} size="xs" color="var(--pi-color-destructive)" />}
      discClassName={styles.errorDisc}
      connector={connector}
    >
      <div className={styles.errorCard}>
        <span className={styles.errorLead}>Error</span> · {row.text}
      </div>
    </RowShell>
  );
}
