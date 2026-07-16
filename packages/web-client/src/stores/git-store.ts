/**
 * Git store — the right-sidebar Changes tab's checkout-status projection (POC `changeList`
 * global + `handleCheckoutStatusUpdate`, POC_TO_APP_PLAN_UI.md §4.7). `applyProjection` ports the
 * POC mapping verbatim: staged entries key off `indexStatus`, unstaged entries key off
 * `worktreeStatus`, untracked paths are always "added"/unstaged.
 */

import { create } from "zustand";

export interface CheckoutFileEntry {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
}

export interface CheckoutStatusProjection {
  available: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  staged: CheckoutFileEntry[];
  unstaged: CheckoutFileEntry[];
  untracked: string[];
  conflicted: string[];
  hasConflicts: boolean;
  unavailableReason?: string;
}

export interface ChangeEntry {
  path: string;
  status: "added" | "deleted" | "modified";
  staged: boolean;
}

interface GitStoreState {
  subscribedCwd: string | null;
  changes: ChangeEntry[];

  setSubscribedCwd(cwd: string | null): void;
  /** Map a `checkout_status_update` projection into flat change rows (POC `handleCheckoutStatusUpdate`). */
  applyProjection(projection: CheckoutStatusProjection | null | undefined): void;
}

export const useGitStore = create<GitStoreState>()((set) => ({
  subscribedCwd: null,
  changes: [],

  setSubscribedCwd: (cwd) => set({ subscribedCwd: cwd }),

  applyProjection: (projection) => {
    if (!projection || !projection.available) {
      set({ changes: [] });
      return;
    }

    const changes: ChangeEntry[] = [];
    for (const f of projection.staged) {
      changes.push({
        path: f.path,
        status: f.indexStatus === "A" ? "added" : f.indexStatus === "D" ? "deleted" : "modified",
        staged: true,
      });
    }
    for (const f of projection.unstaged) {
      changes.push({
        path: f.path,
        status: f.worktreeStatus === "D" ? "deleted" : "modified",
        staged: false,
      });
    }
    for (const path of projection.untracked) {
      changes.push({ path, status: "added", staged: false });
    }
    set({ changes });
  },
}));
