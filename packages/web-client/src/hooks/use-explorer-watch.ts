/**
 * `use-explorer-watch` — keeps the file tree live: subscribes each expanded directory to daemon
 * `file_changed` pushes (task-006's `FileWatchService`, a directory target — no basename filter,
 * so a child being created/deleted/renamed/modified all notify) and invalidates exactly that
 * directory's `rpcKeys.explorer(path)` query when one arrives. Reuses the `file_watch_subscribe`/
 * `file_watch_unsubscribe` RPCs from task-006 as-is — a directory is just another target, no new
 * RPC needed.
 *
 * The actual diff/subscribe/route/dispose logic lives in `createExplorerWatcher`, a plain
 * framework-free factory (mirrors task-007's `watchFile` extraction) — this repo has no jsdom/DOM
 * test environment configured, so it is the seam `use-explorer-watch.test.ts` exercises directly
 * with a fake client + a real `QueryClient`, rather than mounting the hook.
 *
 * Diffs `expanded` across calls to `sync` — subscribes newly-expanded paths, unsubscribes
 * collapsed ones, leaves unchanged ones alone — rather than tearing down and resubscribing the
 * whole set every time, which would churn every watcher on the daemon for a single `Set` identity
 * change. The hook memoizes the diff key as `Array.from(expanded).toSorted().join("\0")`; sorting
 * is THIS hook's own requirement — `use-explorer-tree.ts`'s own `Array.from(expanded)` preserves
 * `Set` insertion order and is not sorted, so two logically-identical sets can produce different
 * arrays there.
 *
 * One `onSessionMessage` handler per watcher (not one per subscribed path), matching pushes
 * against the currently-subscribed set. `too_many_watches` (task-006's per-session cap) is a soft
 * failure: that one directory stays unwatched (falls back to `invalidateAfterToolCompletion`'s
 * existing post-tool debounce) rather than throwing or retrying.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";
import type { PiStudioClient } from "@av-pi-studio/client";

interface FileChangedMessage {
  type: "file_changed";
  path: string;
}

function isFileChangedMessage(msg: unknown): msg is FileChangedMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    msg.type === "file_changed" &&
    "path" in msg &&
    typeof msg.path === "string"
  );
}

interface SubscribeResponse {
  ok?: boolean;
  error?: string;
}

export interface ExplorerWatcher {
  /** Diff `expanded` against the currently-held subscription set and subscribe/unsubscribe
   *  accordingly. Safe to call repeatedly with the same set — a no-op diff issues zero RPCs. */
  sync(expanded: ReadonlySet<string>): void;
  /** Detach the message handler and unsubscribe every currently-held path. */
  dispose(): void;
}

/** Framework-free core: owns one `onSessionMessage` handler and the set of directories currently
 *  subscribed, calling `onChanged(path)` for a push matching one of them. */
export function createExplorerWatcher(
  client: Pick<PiStudioClient, "connection">,
  onChanged: (path: string) => void,
): ExplorerWatcher {
  const subscribed = new Set<string>();

  const unsubscribeMessages = client.connection.onSessionMessage((msg) => {
    const raw: unknown = msg;
    if (!isFileChangedMessage(raw)) return;
    if (!subscribed.has(raw.path)) return;
    onChanged(raw.path);
  });

  return {
    sync(expanded) {
      for (const path of subscribed) {
        if (expanded.has(path)) continue;
        subscribed.delete(path);
        void client.connection.request("file_watch_unsubscribe", { path }).catch(() => {});
      }
      for (const path of expanded) {
        if (subscribed.has(path)) continue;
        subscribed.add(path);
        void client.connection
          .request("file_watch_subscribe", { path })
          .then((res) => {
            const r = res as SubscribeResponse;
            if (r?.ok === false) {
              console.warn(`useExplorerWatch: ${r.error ?? "subscribe failed"} for "${path}"`);
            }
          })
          .catch(() => {});
      }
    },
    dispose() {
      unsubscribeMessages();
      for (const path of subscribed) {
        void client.connection.request("file_watch_unsubscribe", { path }).catch(() => {});
      }
      subscribed.clear();
    },
  };
}

export function useExplorerWatch(expanded: Set<string>): void {
  const client = useConnectionStore((s) => s.client);
  const queryClient = useQueryClient();
  const watcherRef = useRef<ExplorerWatcher | null>(null);
  const clientRef = useRef<Pick<PiStudioClient, "connection"> | null>(null);

  const sortedKey = Array.from(expanded).toSorted().join("\0");

  useEffect(() => {
    if (!client) return;
    if (clientRef.current !== client) {
      // A reconnect swapped in a new client instance — the old socket (and everything it had
      // subscribed) is already gone; dispose the old watcher and start fresh on the new one.
      watcherRef.current?.dispose();
      watcherRef.current = createExplorerWatcher(client, (path) => {
        void queryClient.invalidateQueries({ queryKey: rpcKeys.explorer(path) });
      });
      clientRef.current = client;
    }
    watcherRef.current?.sync(new Set(sortedKey ? sortedKey.split("\0") : []));
  }, [client, sortedKey, queryClient]);

  // Full cleanup on unmount only — independent of how many times the effect above has re-run.
  useEffect(() => {
    return () => {
      watcherRef.current?.dispose();
      watcherRef.current = null;
      clientRef.current = null;
    };
  }, []);
}
