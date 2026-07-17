/**
 * User message row — plain text + optional image thumbnails (POC `.msg.user`,
 * POC_TO_APP_PLAN_UI.md §4.3/§4.4). Images render at up to 200×150, matching the POC's inline
 * `userBubble.appendChild(img)` styling. Clicking a thumbnail opens it full-size in a `Dialog`.
 */

import { useState } from "react";
import { Dialog } from "../../../components/primitives/Dialog.js";
import type { UserRow as UserRowModel } from "../../../timeline/row-model.js";
import styles from "./rows.module.css";

export interface UserRowProps {
  row: UserRowModel;
}

export function UserRow({ row }: UserRowProps) {
  const [openedSrc, setOpenedSrc] = useState<string | null>(null);

  return (
    <div className={`${styles.row} ${styles.user}`}>
      <span className={styles.who}>you</span>
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
