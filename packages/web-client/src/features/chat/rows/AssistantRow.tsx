/**
 * Assistant message row (design spec § 04, sprint-059/task-003; bubble added back per user
 * request after the redesign shipped) — `surface2`-filled bubble, distinct from the user's
 * accent-tinted (blue) bubble so the two speakers stay visually distinguishable; identified
 * further by its rail disc + meta line, same as every other row kind. While streaming, renders
 * plain text with a shared block caret (`.caret`, `RowShell.tsx`'s sibling `rows.module.css`) —
 * re-parsing markdown on every token would be wasteful (§6 Performance strategy). The reducer
 * flips `streaming: false` as soon as the text can no longer grow (Pi's `text_end` block-close
 * marker, or the next tool call / turn boundary), at which point it renders through
 * `<Markdown>` — not at the end of the whole turn.
 */

import { Bot } from "lucide-react";
import { Icon } from "@pi-studio-ui/components/primitives/Icon.js";
import { formatMetaTime } from "@pi-studio-ui/timeline/format-meta-time.js";
import type { AssistantRow as AssistantRowModel } from "@pi-studio-ui/timeline/row-model.js";
import { Markdown } from "@pi-studio-ui/timeline/markdown.js";
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
          <span className={styles.streamingText}>
            {row.text}
            <span className={styles.caret} />
          </span>
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
