/**
 * The Files explorer's transfer lines (desktop-transfer-engine § 7): one line per running activity,
 * oldest first, at most `MAX_ACTIVITY_LINES` and then "and N more". Each line has its text and a
 * Cancel button; a line is memoised on its text, so its DOM changes only when the text does.
 */

import { memo } from "react";
import { X } from "lucide-react";
import {
  type TransferActivity,
  useTransferActivityStore,
} from "../../stores/transfer-activity-store.js";
import {
  activityText,
  cancelActivityName,
  hiddenActivitiesText,
  visibleActivities,
} from "../../stores/transfer-activity-text.js";
import styles from "./ActivityLines.module.css";

const ActivityLine = memo(function ActivityLine({
  text,
  cancelName,
  cancel,
}: {
  text: string;
  cancelName: string;
  cancel: () => void;
}) {
  return (
    <div className={styles.line}>
      <span className={styles.text} title={text}>
        {text}
      </span>
      <button
        type="button"
        className={styles.cancel}
        aria-label={cancelName}
        title={cancelName}
        onClick={cancel}
      >
        <X size={12} />
      </button>
    </div>
  );
});

export function ActivityLines() {
  const activities = useTransferActivityStore((s) => s.activities);
  return <ActivityLinesView activities={activities} />;
}

/** The lines for `activities`, a pure view of them. */
export function ActivityLinesView({ activities }: { activities: readonly TransferActivity[] }) {
  if (activities.length === 0) return null;
  const { shown, hidden } = visibleActivities(activities);
  return (
    <div className={styles.lines}>
      {shown.map((activity) => (
        <ActivityLine
          key={activity.id}
          text={activityText(activity)}
          cancelName={cancelActivityName(activity)}
          cancel={activity.cancel}
        />
      ))}
      {hidden > 0 && <div className={styles.more}>{hiddenActivitiesText(hidden)}</div>}
    </div>
  );
}
