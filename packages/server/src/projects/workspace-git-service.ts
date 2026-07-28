import { defaultGitRunner, type GitRunner } from "./git-detect.js";
import { type CheckoutStatusProjection, projectStatus } from "./status-projection.js";

/**
 * Workspace git service: live status projections streamed as `checkout_status_update`
 * (features/git-checkout.md § Status & diff). Recomputation is change-driven, never polled —
 * `refresh(cwd)` is called by `checkout_refresh_request`'s handler (the client's own post-tool
 * debounce guess, `files-changed.ts`) and by every mutating git RPC (`git-operations.ts`, after
 * commit/checkout/branch/merge/reset). `CheckoutRefreshRequest` is gated by
 * `features.checkoutRefresh`. The daemon's `FileWatchService` (`files/file-watch-service.ts`) is a
 * separate, `file_changed`-only push path for external filesystem changes — it does NOT call
 * `refresh()` and does not affect git-status computation; see its own module header.
 */

export type StatusListener = (projection: CheckoutStatusProjection) => void;

interface Watched {
  listeners: Set<StatusListener>;
  last: string | null; // serialized last projection for change detection
}

export class WorkspaceGitService {
  private readonly watched = new Map<string, Watched>();

  constructor(private readonly gitRunner: GitRunner = defaultGitRunner) {}

  /** One-shot status read for a cwd. */
  getStatus(cwd: string): Promise<CheckoutStatusProjection> {
    return projectStatus(cwd, this.gitRunner);
  }

  /**
   * Subscribe to live status for `cwd`. Emits the current projection immediately, then again on each
   * `refresh(cwd)` that yields a *changed* projection. Returns an unsubscribe fn.
   */
  subscribe(cwd: string, listener: StatusListener): () => void {
    let entry = this.watched.get(cwd);
    if (!entry) {
      entry = { listeners: new Set(), last: null };
      this.watched.set(cwd, entry);
    }
    entry.listeners.add(listener);
    // Emit current state immediately (snapshot on subscribe).
    void this.emit(cwd, listener);
    return () => {
      const e = this.watched.get(cwd);
      if (!e) return;
      e.listeners.delete(listener);
      if (e.listeners.size === 0) this.watched.delete(cwd);
    };
  }

  /**
   * Recompute status for `cwd` and notify listeners only when the projection changed since the last
   * emit (dedupe — no spurious updates). Returns true when an update was broadcast.
   */
  async refresh(cwd: string): Promise<boolean> {
    const entry = this.watched.get(cwd);
    if (!entry || entry.listeners.size === 0) return false;
    const projection = await projectStatus(cwd, this.gitRunner);
    const serialized = JSON.stringify(projection);
    if (serialized === entry.last) return false;
    entry.last = serialized;
    for (const listener of entry.listeners) listener(projection);
    return true;
  }

  private async emit(cwd: string, listener: StatusListener): Promise<void> {
    const projection = await projectStatus(cwd, this.gitRunner);
    const entry = this.watched.get(cwd);
    if (entry) entry.last = JSON.stringify(projection);
    listener(projection);
  }
}
