/**
 * User message row — plain text + optional image thumbnails (POC `.msg.user`,
 * POC_TO_APP_PLAN_UI.md §4.3/§4.4). Images render at up to 200×150, matching the POC's inline
 * `userBubble.appendChild(img)` styling. Clicking a thumbnail opens it full-size in a `Dialog`.
 *
 * `row.pending` (optimistic echo not yet confirmed by the server's `user_message` broadcast —
 * see Composer.tsx) dims the row via CSS; `row.failed` (the RPC rejected before confirmation
 * ever arrived) tints it toward the error color and appends a "failed to send" label instead.
 * `row.queued` (steered mid-turn, not yet handed to the LLM — cleared by a `queue_update` stream
 * event, see `timeline/reducer.ts`'s `onQueueUpdate`) shows a small "queued" pill next to the
 * sender label. All three are terminal/transient states set by the reducer — this component only
 * reflects them.
 */

import { useState } from "react";
import { Clock } from "lucide-react";
import { Dialog } from "@pi-studio-ui/components/primitives/Dialog.js";
import type { UserRow as UserRowModel } from "@pi-studio-ui/timeline/row-model.js";
import styles from "./rows.module.css";

export interface UserRowProps {
  row: UserRowModel;
}

export function UserRow({ row }: UserRowProps) {
  const [openedSrc, setOpenedSrc] = useState<string | null>(null);

  const stateClass = row.failed
    ? styles.userFailed
    : row.pending
      ? styles.userPending
      : row.queued
        ? styles.userQueued
        : "";

  return (
    <div className={`${styles.row} ${styles.user}${stateClass ? ` ${stateClass}` : ""}`}>
      <span className={styles.who}>
        you{row.failed ? " · failed to send" : ""}
        {row.queued && !row.failed && (
          <span className={styles.queuedBadge}>
            <Clock size={9} />
            queued
          </span>
        )}
      </span>
      {row.text}
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
    </div>
  );
}
