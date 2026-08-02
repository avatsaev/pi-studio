/**
 * Git store — the right-sidebar Changes tab's checkout-status projection (POC `changeList`
 * global + `handleCheckoutStatusUpdate`, POC_TO_APP_PLAN_UI.md §4.7). `applyProjection` ports the
 * POC mapping verbatim: staged entries key off `indexStatus`, unstaged entries key off
 * `worktreeStatus`, untracked paths are always "added"/unstaged.
 *
 * Also retains the projection's branch metadata (branch/ahead/behind/detached/upstream/conflict
 * count/availability) for the workspace status bar's git segment (sprint-042) — previously
 * discarded here even though `use-checkout-status.ts` already receives the full projection.
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
  /** Gitignored paths (server's `--ignored=traditional` `!` lines). Optional — a daemon older
   * than this field simply omits it. Deliberately NOT folded into `changes`, which drive the
   * Changes tab and the status bar's dirty count; only the Files tree reads this, to ghost
   * ignored rows (`git-status-index.ts`). */
  ignored?: string[];
  conflicted: string[];
  hasConflicts: boolean;
  unavailableReason?: string;
}

export interface ChangeEntry {
  path: string;
  status: "added" | "deleted" | "modified";
  staged: boolean;
}

/** Branch metadata reset when a cwd isn't a git repo (or has no projection yet). */
const EMPTY_BRANCH_META = {
  available: false,
  branch: null as string | null,
  upstream: null as string | null,
  ahead: 0,
  behind: 0,
  detached: false,
  conflictCount: 0,
};

interface GitStoreState {
  subscribedCwd: string | null;
  changes: ChangeEntry[];
  available: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  conflictCount: number;
  /** Workspace-relative gitignored paths; a wholly ignored directory arrives as one `dir/` entry. */
  ignored: string[];

  setSubscribedCwd(cwd: string | null): void;
  /** Map a `checkout_status_update` projection into flat change rows (POC `handleCheckoutStatusUpdate`)
   * plus the branch metadata above. */
  applyProjection(projection: CheckoutStatusProjection | null | undefined): void;
}

export const useGitStore = create<GitStoreState>()((set) => ({
  subscribedCwd: null,
  changes: [],
  ignored: [],
  ...EMPTY_BRANCH_META,

  setSubscribedCwd: (cwd) => set({ subscribedCwd: cwd }),

  applyProjection: (projection) => {
    if (!projection || !projection.available) {
      set({ changes: [], ignored: [], ...EMPTY_BRANCH_META });
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
    set({
      changes,
      ignored: projection.ignored ?? [],
      available: true,
      branch: projection.branch,
      upstream: projection.upstream,
      ahead: projection.ahead,
      behind: projection.behind,
      detached: projection.detached,
      conflictCount: projection.conflicted.length,
    });
  },
}));
