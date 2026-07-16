/**
 * User message row — plain text + optional image thumbnails (POC `.msg.user`,
 * POC_TO_APP_PLAN_UI.md §4.3/§4.4). Images render at up to 200×150, matching the POC's inline
 * `userBubble.appendChild(img)` styling.
 */

import type { UserRow as UserRowModel } from "../../../timeline/row-model.js";
import styles from "./rows.module.css";

export interface UserRowProps {
  row: UserRowModel;
}

export function UserRow({ row }: UserRowProps) {
  return (
    <div className={`${styles.row} ${styles.user}`}>
      <span className={styles.who}>you</span>
      {row.text}
      {row.images && row.images.length > 0 && (
        <div className={styles.userImages}>
          {row.images.map((img, i) => (
            <img
              key={i}
              className={styles.userImage}
              src={`data:${img.mimeType ?? "image/png"};base64,${img.data ?? ""}`}
              alt=""
            />
          ))}
        </div>
      )}
    </div>
  );
}
