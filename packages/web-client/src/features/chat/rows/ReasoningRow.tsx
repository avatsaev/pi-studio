/**
 * Reasoning row (design spec § 04, sprint-059/task-003) — italic, muted body visually distinct
 * from assistant replies, with a muted rail disc and a small `final` chip on the meta line once
 * the block closes. Renders live markdown while streaming, same split-by-block path and rationale
 * as `AssistantRow`.
 */

import { Brain } from "lucide-react";
import { Icon } from "@pi-studio-ui/components/primitives/Icon.js";
import { formatMetaTime } from "@pi-studio-ui/timeline/format-meta-time.js";
import type { ReasoningRow as ReasoningRowModel } from "@pi-studio-ui/timeline/row-model.js";
import { Markdown, StreamingMarkdown } from "@pi-studio-ui/timeline/markdown.js";
import { RowShell } from "./RowShell.js";
import shellStyles from "./RowShell.module.css";
import styles from "./rows.module.css";

export interface ReasoningRowProps {
  row: ReasoningRowModel;
  owningPaneId?: string | null;
  workspaceCwd?: string | null;
  /** Draw the rail connector below this row. `false` on the timeline's last row. */
  connector: boolean;
}

export function ReasoningRow({
  row,
  owningPaneId = null,
  workspaceCwd = null,
  connector,
}: ReasoningRowProps) {
  const time = formatMetaTime(row.timestamp);
  return (
    <RowShell
      disc={<Icon icon={Brain} size="xs" color="var(--pi-color-foregroundMuted)" />}
      discClassName={styles.reasoningDisc}
      connector={connector}
      meta={
        <>
          Reasoning
          {time && <span className={shellStyles.metaTime}> · {time}</span>}
        </>
      }
      metaTrailing={!row.streaming && <span className={styles.finalChip}>final</span>}
    >
      <div className={styles.reasoningBody}>
        {row.streaming ? (
          <StreamingMarkdown
            text={row.text}
            owningPaneId={owningPaneId}
            workspaceCwd={workspaceCwd}
          />
        ) : (
          <Markdown text={row.text} owningPaneId={owningPaneId} workspaceCwd={workspaceCwd} />
        )}
      </div>
    </RowShell>
  );
}
