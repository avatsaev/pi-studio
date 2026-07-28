import { statSync, watch as fsWatch, type FSWatcher, type Stats } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { Logger } from "../logging/logger.js";

/**
 * The daemon's first real filesystem watcher (architecture/websocket-protocol.md § push/
 * subscription families; features/file-explorer-transfer.md § listings, § file preview). Backs
 * both the molecule viewer's live reload (task-007) and the live file tree (task-008) via a single
 * `subscribe(path, listener)` primitive that watches one file OR one directory.
 *
 * Every daemon-*initiated* mutation already refreshes and pushes correctly today (every mutating
 * git RPC calls `WorkspaceGitService.refresh(cwd)` itself, and `checkout_refresh_request` covers
 * the client's own post-tool guess). What was missing — and what this class exists for — is a
 * change the daemon did **not** itself perform: an external editor, a shell command, a build step,
 * or `git` run inside a pi-studio terminal. Those produce no `refresh()` call and, before this,
 * no push at all.
 */

/** Per-subscription debounce: collapses a write+rename burst into one push (chosen above
 *  `TerminalManager`'s latency-driven 4 ms and safely below `files-changed.ts`'s 500 ms client
 *  debounce so daemon pushes never race the client's own post-tool invalidation). */
export const FILE_WATCH_COALESCE_MS = 150;

export interface FileWatchServiceOptions {
  /** Per-subscription debounce window. Overridable for tests; defaults to `FILE_WATCH_COALESCE_MS`. */
  coalesceMs?: number;
  logger?: Logger;
}

interface Subscription {
  /** `null` for a directory target (no filter — every event in the directory matches, including
   *  a child file being modified). Otherwise the exact basename a file target watches for. */
  basenameFilter: string | null;
  listener: () => void;
  timer: NodeJS.Timeout | undefined;
}

interface DirWatch {
  watcher: FSWatcher;
  subs: Set<Subscription>;
  refCount: number;
}

export class FileWatchService {
  private readonly coalesceMs: number;
  private readonly logger?: Logger;
  private readonly dirs = new Map<string, DirWatch>();

  constructor(options: FileWatchServiceOptions = {}) {
    this.coalesceMs = options.coalesceMs ?? FILE_WATCH_COALESCE_MS;
    this.logger = options.logger;
  }

  /**
   * Watch one file OR one directory. Fires whenever the target changes; for a directory that
   * includes children being created, deleted, renamed, or modified. Returns an unsubscribe
   * function that is always safe to call, even for a path that could not be watched.
   */
  subscribe(rawPath: string, listener: () => void): () => void {
    // Resolve `~` server-side before anything else (root `AGENTS.md` invariant 7), mirroring
    // `bootstrap.ts`'s own `path.startsWith("~") ? join(homedir(), path.slice(1)) : path`
    // expansion — duplicated inline per that file's own convention (already duplicated verbatim
    // across `bootstrap.ts` and `dev-bootstrap.ts`) rather than factored into a shared helper.
    const resolved = rawPath.startsWith("~") ? join(homedir(), rawPath.slice(1)) : rawPath;
    const isDirectory = statSafe(resolved)?.isDirectory() ?? false;
    // A file target (including one that does not exist yet) watches its *parent* directory and
    // filters by basename — never a direct file handle. Editors and agents commonly save via
    // write-temp + atomic rename, which replaces the inode; a watcher bound to the original file
    // stops firing after the first such save, which this deliberately avoids.
    const dirPath = isDirectory ? resolved : dirname(resolved);
    const basenameFilter = isDirectory ? null : basename(resolved);

    const dirWatch = this.ensureDirWatch(dirPath);
    if (!dirWatch) return () => {};

    const sub: Subscription = { basenameFilter, listener, timer: undefined };
    dirWatch.subs.add(sub);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      clearTimeout(sub.timer);
      dirWatch.subs.delete(sub);
      this.releaseDirWatch(dirPath);
    };
  }

  /** Stop every watcher (daemon shutdown). */
  close(): void {
    for (const dirPath of this.dirs.keys()) this.teardownDirWatch(dirPath);
  }

  /** Test-only observability seam: number of distinct directories currently holding a live
   *  `fs.watch` handle. Not part of the public contract — exists so tests can assert a handle is
   *  actually released once its last subscriber leaves, not merely that pushes stop. */
  get watchedDirectoryCount(): number {
    return this.dirs.size;
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private ensureDirWatch(dirPath: string): DirWatch | undefined {
    const existing = this.dirs.get(dirPath);
    if (existing) {
      existing.refCount++;
      return existing;
    }
    let watcher: FSWatcher;
    try {
      watcher = fsWatch(dirPath, { persistent: false }, (_eventType, filename) => {
        this.onEvent(dirPath, filename ? filename.toString() : null);
      });
    } catch (err) {
      this.logger?.debug(
        { dirPath, err: (err as Error).message },
        "file-watch: cannot watch directory",
      );
      return undefined;
    }
    const dirWatch: DirWatch = { watcher, subs: new Set(), refCount: 1 };
    watcher.on("error", (err: unknown) => {
      this.logger?.warn(
        { dirPath, err: (err as Error)?.message ?? String(err) },
        "file-watch: watcher error — emitting a final notification and dropping",
      );
      const subsSnapshot = [...dirWatch.subs];
      this.teardownDirWatch(dirPath);
      // One final notification per subscriber so the client refetches and observes e.g. a
      // deletion of the watched directory itself, bypassing the coalescing window entirely
      // since the watcher is already gone and nothing would flush a pending timer.
      for (const sub of subsSnapshot) fireSafely(sub.listener);
    });
    this.dirs.set(dirPath, dirWatch);
    return dirWatch;
  }

  private releaseDirWatch(dirPath: string): void {
    const dirWatch = this.dirs.get(dirPath);
    if (!dirWatch) return; // Already torn down (e.g. by a watcher error).
    dirWatch.refCount--;
    if (dirWatch.refCount <= 0) this.teardownDirWatch(dirPath);
  }

  private teardownDirWatch(dirPath: string): void {
    const dirWatch = this.dirs.get(dirPath);
    if (!dirWatch) return;
    this.dirs.delete(dirPath);
    for (const sub of dirWatch.subs) clearTimeout(sub.timer);
    try {
      dirWatch.watcher.close();
    } catch {
      // Already closed.
    }
  }

  private onEvent(dirPath: string, filename: string | null): void {
    const dirWatch = this.dirs.get(dirPath);
    if (!dirWatch) return;
    for (const sub of dirWatch.subs) {
      // `filename` can be null on some platforms for some events — treat that as "something
      // changed, notify everyone" rather than guessing, matching the deliberate platform-portable
      // "every event means refetch" design (no per-event-type logic).
      if (sub.basenameFilter === null || filename === null || filename === sub.basenameFilter) {
        this.scheduleFire(sub);
      }
    }
  }

  private scheduleFire(sub: Subscription): void {
    if (sub.timer) return; // A burst inside the coalescing window collapses to one push.
    sub.timer = setTimeout(() => {
      sub.timer = undefined;
      fireSafely(sub.listener);
    }, this.coalesceMs);
  }
}

/** Stats the path, or `undefined` for a nonexistent/unreadable one — treated by `subscribe()` as
 *  a file target (see there) rather than a hard failure. */
function statSafe(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

/** Runs a listener inside try/catch so one throwing subscriber cannot break another subscriber's
 *  delivery, the watcher's own event callback, or (via an uncaught `fs.watch` callback exception)
 *  the process. Mirrors `SessionSubscriptions`'s `disposeSafely`. */
function fireSafely(listener: () => void): void {
  try {
    listener();
  } catch {
    // Intentionally swallowed.
  }
}
