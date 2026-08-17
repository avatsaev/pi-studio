/**
 * User message row — shrink-to-fit accent bubble on the shared rail scaffold (design spec § 04,
 * sprint-059/task-003), right-aligned within the content column (`.userAligned`, task-005 follow-
 * up) so it stays visually distinct from the left-flowing assistant/tool rows sharing the same
 * rail — the disc/connector stay on the rail's fixed left column for continuity; only the bubble,
 * meta line and image row shift to the content column's right edge. The rail disc is a
 * `color-mix(statusSuccess 65%, surface3)` fill with a `successForeground` (white) icon — a
 * distinct green marker for "this is you" without the raw saturation of the full-strength token
 * (tried and walked back after user feedback), and not the low-opacity muted tint other non-accent
 * discs (`ErrorRow`, `ReasoningRow`) use, which read as too bland here; the bubble itself stays
 * accent-tinted. Images render at up to
 * 200×150 inside the bubble's content column, matching the POC's inline
 * `userBubble.appendChild(img)` styling. Clicking a thumbnail opens it full-size in a `Dialog`.
 *
 * `row.pending` (optimistic echo not yet confirmed by the server's `user_message` broadcast —
 * see Composer.tsx) dims the whole row via CSS; `row.failed` (the RPC rejected before
 * confirmation ever arrived) turns the bubble into a destructive-tinted variant of itself and
 * appends a "failed to send" label to the meta line instead of a solid error fill — this is a
 * transient, retryable state, not an end state. `row.queued` (steered mid-turn, not yet handed to
 * the LLM — cleared by a `queue_update` stream event, see `timeline/reducer.ts`'s
 * `onQueueUpdate`) shows a small "queued" chip on the meta line. All three are terminal/transient
 * states set by the reducer — this component only reflects them.
 */

import { useState } from "react";
import { Clock, User } from "lucide-react";
import { clsx } from "clsx";
import { Dialog } from "@pi-studio-ui/components/primitives/Dialog.js";
import { Icon } from "@pi-studio-ui/components/primitives/Icon.js";
import { formatMetaTime } from "@pi-studio-ui/timeline/format-meta-time.js";
import type { UserRow as UserRowModel } from "@pi-studio-ui/timeline/row-model.js";
import { RowShell } from "./RowShell.js";
import shellStyles from "./RowShell.module.css";
import styles from "./rows.module.css";

export interface UserRowProps {
  row: UserRowModel;
  /** Draw the rail connector below this row. `false` on the timeline's last row. */
  connector: boolean;
}

export function UserRow({ row, connector }: UserRowProps) {
  const [openedSrc, setOpenedSrc] = useState<string | null>(null);
  const time = formatMetaTime(row.timestamp);

  return (
    <RowShell
      disc={<Icon icon={User} size="xs" color="var(--pi-color-successForeground)" />}
      discClassName={styles.userDisc}
      connector={connector}
      className={clsx(styles.userAligned, row.pending && styles.userPendingRow)}
      meta={
        <>
          You
          {time && <span className={shellStyles.metaTime}> · {time}</span>}
          {row.failed && " · failed to send"}
        </>
      }
      metaTrailing={
        row.queued &&
        !row.failed && (
          <span className={styles.queuedBadge}>
            <Clock size={9} />
            queued
          </span>
        )
      }
    >
      <span className={clsx(styles.userBubble, row.failed && styles.userBubbleFailed)}>
        {row.text}
      </span>
      {row.images && row.images.length > 0 && (
        <div className={styles.userImages}>
          {row.images.map((img, i) => {
            const src = `data:${img.mimeType ?? "image/png"};base64,${img.data ?? ""}`;
            return (
              <img
                key={i}
                className={styles.userImage}
                src={src}
                alt=""
                role="button"
                tabIndex={0}
                onClick={() => setOpenedSrc(src)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") setOpenedSrc(src);
                }}
              />
            );
          })}
        </div>
      )}
      <Dialog
        open={openedSrc !== null}
        onOpenChange={(open) => {
          if (!open) setOpenedSrc(null);
        }}
        title="Image"
        width="auto"
        bare
        className={styles.imageDialog}
      >
        {openedSrc && <img className={styles.imageDialogPreview} src={openedSrc} alt="" />}
      </Dialog>
    </RowShell>
  );
}
