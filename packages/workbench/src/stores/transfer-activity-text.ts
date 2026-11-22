/**
 * The text of a transfer activity's line (desktop-transfer-engine § 7), as a pure function of the
 * activity: `Uploading 3 files… 42%`, `Downloading report.pdf… waiting for the connection`.
 */

import { type TransferActivity } from "./transfer-activity-store.js";

/** Whole percent of `done` in `total`, or `null` when the size is unknown or empty. */
export function percentOf(done: number, total: number | undefined): number | null {
  if (total === undefined || total <= 0) return null;
  return Math.min(100, Math.floor((done / total) * 100));
}

/**
 * `waiting` replaces the percentage with "waiting for the connection", `queued` with "waiting". A
 * running activity shows its percentage, or only the label while the size is unknown.
 */
export function activityText(
  activity: Pick<TransferActivity, "label" | "percent" | "state">,
): string {
  const head = `${activity.label}…`;
  if (activity.state === "waiting") return `${head} waiting for the connection`;
  if (activity.state === "queued") return `${head} waiting`;
  return activity.percent === null ? head : `${head} ${activity.percent}%`;
}

/** The most activity lines the explorer draws; the rest are counted. */
export const MAX_ACTIVITY_LINES = 4;

/**
 * The lines to draw out of `activities` (oldest first): the first `MAX_ACTIVITY_LINES`, and how many
 * further ones are left out.
 */
export function visibleActivities<T>(activities: readonly T[]): {
  shown: readonly T[];
  hidden: number;
} {
  return {
    shown: activities.slice(0, MAX_ACTIVITY_LINES),
    hidden: Math.max(0, activities.length - MAX_ACTIVITY_LINES),
  };
}

/** The line that counts the activities left out of the list. */
export function hiddenActivitiesText(hidden: number): string {
  return `and ${hidden} more`;
}

/** The accessible name of a line's Cancel button: stable while the percentage moves. */
export function cancelActivityName(activity: Pick<TransferActivity, "label">): string {
  return `Cancel: ${activity.label}`;
}
