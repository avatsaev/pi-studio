/**
 * Transfer activities (desktop-transfer-engine § 7, S8) — every batch of uploads and every save
 * that is running, oldest first, with what the Files explorer needs to draw one line each: a label,
 * a percentage or a state, and a cancel. A batch of uploads is one activity (D11); each save is its
 * own. A save from a viewer's toolbar registers here as well, so the explorer shows it.
 *
 * When an activity ends the store also keeps the outcome as `lastResult` — the explorer's one
 * transient status ("Uploaded 3 files", "Download cancelled"…) is drawn from it, so the text
 * survives the explorer not being mounted when the transfer ends.
 *
 * The line's text is a pure function of the activity (`activityText`); `update` ignores a patch that
 * changes nothing, so a line re-renders only when its text could change.
 */

import { create } from "zustand";
import { type TransferState } from "../host/types.js";

export interface TransferActivity {
  readonly id: string;
  readonly kind: "upload" | "save";
  /** What is being moved, without the ellipsis: `Uploading 3 files`, `Downloading report.pdf`. */
  readonly label: string;
  /** Whole percent, or `null` while no size is known. */
  readonly percent: number | null;
  readonly state: TransferState;
  /** Aborts the transfer. A no-op once it has settled. */
  readonly cancel: () => void;
}

/** What the explorer's transient status says once an activity has ended. */
export interface TransferOutcome {
  readonly text: string;
  readonly error: boolean;
}

export interface TransferResult extends TransferOutcome {
  /** Grows with every result, so a repeated text is still a new result. */
  readonly seq: number;
}

export interface NewTransferActivity {
  kind: TransferActivity["kind"];
  label: string;
  cancel: () => void;
  percent?: number | null;
  state?: TransferState;
}

export type TransferActivityPatch = Partial<Pick<TransferActivity, "percent" | "state">>;

interface TransferActivityStoreState {
  /** Running activities, oldest first. */
  activities: readonly TransferActivity[];
  /** The latest outcome nobody has cleared yet. */
  lastResult: TransferResult | null;
  /** Register an activity at the end of the list; returns its id. */
  add(init: NewTransferActivity): string;
  /** Change an activity's percentage or state. A patch that changes nothing leaves the store as is. */
  update(id: string, patch: TransferActivityPatch): void;
  /** Drop an activity, recording `outcome` as the last result when given. */
  remove(id: string, outcome?: TransferOutcome): void;
  /** Record an outcome for a transfer that never had an activity. */
  report(outcome: TransferOutcome): void;
  /** Forget the last result — only if it is still `seq`'s, so a newer one is kept. */
  clearResult(seq: number): void;
}

let nextActivity = 0;
let nextResult = 0;

const toResult = (outcome: TransferOutcome): TransferResult => ({
  text: outcome.text,
  error: outcome.error,
  seq: ++nextResult,
});

export const useTransferActivityStore = create<TransferActivityStoreState>()((set) => ({
  activities: [],
  lastResult: null,

  add(init) {
    const id = `transfer-${++nextActivity}`;
    const activity: TransferActivity = {
      id,
      kind: init.kind,
      label: init.label,
      percent: init.percent ?? null,
      state: init.state ?? "running",
      cancel: init.cancel,
    };
    set((s) => ({ activities: [...s.activities, activity] }));
    return id;
  },

  update(id, patch) {
    set((s) => {
      const index = s.activities.findIndex((a) => a.id === id);
      const current = s.activities[index];
      if (!current) return s;
      const percent = patch.percent === undefined ? current.percent : patch.percent;
      const state = patch.state ?? current.state;
      if (percent === current.percent && state === current.state) return s;
      const activities = s.activities.slice();
      activities[index] = { ...current, percent, state };
      return { activities };
    });
  },

  remove(id, outcome) {
    set((s) => {
      const activities = s.activities.filter((a) => a.id !== id);
      if (activities.length === s.activities.length && !outcome) return s;
      return outcome ? { activities, lastResult: toResult(outcome) } : { activities };
    });
  },

  report(outcome) {
    set({ lastResult: toResult(outcome) });
  },

  clearResult(seq) {
    set((s) => (s.lastResult?.seq === seq ? { lastResult: null } : s));
  },
}));

/** A transfer rejected because its signal aborted (a cancel), not because it failed. */
export function isAbortError(error: unknown): boolean {
  return (error instanceof Error || error instanceof DOMException) && error.name === "AbortError";
}
