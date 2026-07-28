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

/** Subscribes `path` on `client.connection`, calls `onChanged` for every matching `file_changed`
 *  push, and returns a cleanup function that detaches the handler AND sends
 *  `file_watch_unsubscribe` for `path`. Framework-agnostic on purpose — see module header. */
export function watchFile(
  client: Pick<PiStudioClient, "connection">,
  path: string,
  onChanged: (changedAt: number) => void,
): () => void {
  let cancelled = false;
  void client.connection.request("file_watch_subscribe", { path }).catch(() => {});

  const unsubscribeMessages = client.connection.onSessionMessage((msg) => {
    if (cancelled) return;
    const raw: unknown = msg;
    if (!isFileChangedMessage(raw)) return;
    if (raw.path !== path) return;
    onChanged(Date.now());
  });

  return () => {
    if (cancelled) return; // Idempotent: a second call must never double-send the RPC.
    cancelled = true;
    unsubscribeMessages();
    void client.connection.request("file_watch_unsubscribe", { path }).catch(() => {});
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
