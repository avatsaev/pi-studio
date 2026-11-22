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
