/**
 * `use-file-watch` — subscribes to live daemon `file_changed` pushes for a path (task-006's
 * `FileWatchService`), structurally mirroring `use-checkout-status.ts`: subscribe on mount/path
 * change via `file_watch_subscribe`, route matching pushes through `onSessionMessage`, and on
 * cleanup detach the message handler AND send `file_watch_unsubscribe` for the path being left —
 * `use-checkout-status.ts`'s own header comment calls out that leaving either half undone is the
 * leak this pattern exists to avoid.
 *
 * The actual subscribe/route/cleanup wiring lives in `watchFile`, a plain function with no React
 * dependency (mirrors `molecule-source.ts`/`molecule-reload.ts`'s "extract the testable core"
 * convention) — this repo has no DOM test environment set up, so it is the seam
 * `use-file-watch.test.ts` exercises directly with a fake client rather than mounting the hook.
 *
 * A `null` path (an empty "+"-menu molecule tab, or the absence of a client) subscribes nothing.
 *
 * `watchFile` ref-counts subscriptions per `(client, path)` in a module-level registry (mirrors
 * `file-transfer-instance.ts`'s `WeakMap<DaemonClient, …>` shared-instance convention): more than
 * one component can watch the same file (a file tab and a diff tab on the same path) and share
 * ONE daemon watch, rather than the second `file_watch_unsubscribe` killing it for both — the
 * daemon's `SessionSubscriptions.add` disposes any existing entry for the same resolved-path key.
 * The entry also remembers the RESOLVED path echoed back by `file_watch_subscribe_response.path`
 * (the daemon expands a leading `~` server-side before pushing `file_changed`), and matches a
 * push against either the requested spelling or that resolved path.
 */

import { useEffect, useState } from "react";
import type { PiStudioClient } from "@av-pi-studio/client";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";

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

interface FileWatchSubscribeResponse {
  ok?: boolean;
  error?: string;
  path?: string;
}

interface WatchEntry {
  count: number;
  /** Resolved path echoed by `file_watch_subscribe_response.path`; `null` until it arrives. */
  resolvedPath: string | null;
  listeners: Set<(changedAt: number) => void>;
  dispose: () => void;
}

const watchesByClient = new WeakMap<Pick<PiStudioClient, "connection">, Map<string, WatchEntry>>();

/** Subscribes `path` on `client.connection`, calls `onChanged` for every matching `file_changed`
 *  push, and returns a cleanup function that detaches the handler AND sends
 *  `file_watch_unsubscribe` for `path` once the LAST subscriber for that `(client, path)` pair
 *  releases it. Framework-agnostic on purpose — see module header. */
export function watchFile(
  client: Pick<PiStudioClient, "connection">,
  path: string,
  onChanged: (changedAt: number) => void,
): () => void {
  let entries = watchesByClient.get(client);
  if (!entries) {
    entries = new Map<string, WatchEntry>();
    watchesByClient.set(client, entries);
  }

  let entry = entries.get(path);
  if (!entry) {
    const created: WatchEntry = {
      count: 0,
      resolvedPath: null,
      listeners: new Set(),
      dispose: () => {},
    };

    const unsubscribeMessages = client.connection.onSessionMessage((msg) => {
      const raw: unknown = msg;
      if (!isFileChangedMessage(raw)) return;
      if (raw.path !== path && raw.path !== created.resolvedPath) return;
      const changedAt = Date.now();
      for (const listener of created.listeners) listener(changedAt);
    });

    void client.connection
      .request("file_watch_subscribe", { path })
      .then((res) => {
        const response = res as FileWatchSubscribeResponse;
        if (response?.ok === false) {
          console.warn(`watchFile: ${response.error ?? "subscribe failed"} for "${path}"`);
          return;
        }
        if (typeof response?.path === "string") {
          created.resolvedPath = response.path;
        }
      })
      .catch(() => {});

    created.dispose = () => {
      unsubscribeMessages();
      void client.connection.request("file_watch_unsubscribe", { path }).catch(() => {});
    };

    entry = created;
    entries.set(path, entry);
  }

  entry.count++;
  entry.listeners.add(onChanged);

  let released = false;
  return () => {
    if (released) return; // Idempotent: a second call must never double-release.
    released = true;
    const current = entries!.get(path);
    if (!current) return;
    current.listeners.delete(onChanged);
    current.count--;
    if (current.count === 0) {
      entries!.delete(path);
      current.dispose();
    }
  };
}

export interface UseFileWatchResult {
  /** Monotonic timestamp of the last `file_changed` push for this path; `null` if none yet. */
  changedAt: number | null;
}

export function useFileWatch(path: string | null): UseFileWatchResult {
  const client = useConnectionStore((s) => s.client);
  const [changedAt, setChangedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!client || !path) return;
    return watchFile(client, path, setChangedAt);
  }, [client, path]);

  return { changedAt };
}
