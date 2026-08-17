/**
 * Assistant message row (design spec § 04, sprint-059/task-003; bubble added back per user
 * request after the redesign shipped) — `surface2`-filled bubble, distinct from the user's
 * accent-tinted (blue) bubble so the two speakers stay visually distinguishable; identified
 * further by its rail disc + meta line, same as every other row kind.
 *
 * Markdown renders live, mid-stream: `StreamingMarkdown` renders every block the model has
 * finished (parsed once each, memoized) plus the one it is still writing (a short lean parse per
 * token delta), with the caret after the last rendered element. Re-parsing the *whole* message per
 * delta is what would be wasteful (§6 Performance strategy) — ~9–27ms for a 3.5–10KB message,
 * every token. The reducer's `streaming: false` (Pi's `text_end` block-close marker, or the next
 * tool call / turn boundary) now only swaps the split render for one canonical full parse.
 */

import { Bot } from "lucide-react";
import { Icon } from "@pi-studio-ui/components/primitives/Icon.js";
import { formatMetaTime } from "@pi-studio-ui/timeline/format-meta-time.js";
import type { AssistantRow as AssistantRowModel } from "@pi-studio-ui/timeline/row-model.js";
import { Markdown, StreamingMarkdown } from "@pi-studio-ui/timeline/markdown.js";
import { RowShell } from "./RowShell.js";
import shellStyles from "./RowShell.module.css";
import styles from "./rows.module.css";

export interface AssistantRowProps {
  row: AssistantRowModel;
  assetBase?: string | null;
  owningPaneId?: string | null;
  workspaceCwd?: string | null;
  /** Draw the rail connector below this row. `false` on the timeline's last row. */
  connector: boolean;
}

export function AssistantRow({
  row,
  assetBase = null,
  owningPaneId = null,
  workspaceCwd = null,
  connector,
}: AssistantRowProps) {
  const time = formatMetaTime(row.timestamp);
  return (
    <RowShell
      disc={<Icon icon={Bot} size="xs" color="var(--pi-color-accentForeground)" />}
      discClassName={styles.assistantDisc}
      connector={connector}
      meta={
        <>
          Assistant
          {time && <span className={shellStyles.metaTime}> · {time}</span>}
        </>
      }
    >
      <div className={styles.assistantBody}>
        {row.streaming ? (
          <StreamingMarkdown
            text={row.text}
            assetBase={assetBase}
            owningPaneId={owningPaneId}
            workspaceCwd={workspaceCwd}
          />
        ) : (
          <Markdown
            text={row.text}
            assetBase={assetBase}
            owningPaneId={owningPaneId}
            workspaceCwd={workspaceCwd}
          />
        )}
      </div>
    </RowShell>
  );
}
