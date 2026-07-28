/**
 * `use-inline-image` — fetches (via the shared ref-counted `inline-image-cache`) and hands back
 * an object URL for an inline chat image (features/inline-image-rendering.md § Inline image fetch
 * + cache). Consumed by the markdown `img` node override (task-004) once a `classifyImageSrc`
 * result is `local`.
 *
 * Deliberately NOT a TanStack Query hook, and therefore no `rpcKeys` entry: the whole point of
 * `inline-image-cache.ts` is a retention policy (revoke only on LRU eviction, never on unmount)
 * that Query's cache cannot express. Do not "fix" this into a `useQuery` — see that module's
 * header for why.
 *
 * `loadInlineImage` is the actual effect body, extracted for direct unit testing without
 * rendering — this package has no jsdom/React-Testing-Library environment (`AGENTS.md`'s testing
 * convention; mirrors `use-file-watch.ts`'s `watchFile` extraction).
 */

import { useEffect, useState } from "react";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { acquireInlineImage, releaseInlineImage } from "@pi-studio-ui/lib/inline-image-cache.js";
import { transferFor } from "./file-transfer-instance.js";

export type InlineImageState =
  | { status: "idle" } // no client yet, or path is null
  | { status: "loading" }
  | { status: "ready"; objectUrl: string }
  | { status: "error"; message: string };

/**
 * Runs one effect cycle: `download === null` (no live connection, or no path) is the idle case —
 * nothing to acquire, nothing to clean up. Otherwise acquires `path`, reports the loading →
 * ready/error transition via `onStateChange`, and returns a cleanup that releases the path and
 * ignores a resolution that lands after it (the `cancelled` flag pattern used across the existing
 * hooks, e.g. `use-checkout-status.ts`).
 */
export function loadInlineImage(
  path: string | null,
  download: ((path: string) => Promise<{ bytes: Uint8Array; mimeType?: string }>) | null,
  onStateChange: (state: InlineImageState) => void,
): (() => void) | void {
  if (!path || !download) {
    onStateChange({ status: "idle" });
    return;
  }

  let cancelled = false;
  onStateChange({ status: "loading" });

  acquireInlineImage(path, download)
    .then((entry) => {
      if (!cancelled) onStateChange({ status: "ready", objectUrl: entry.objectUrl });
    })
    .catch((error: unknown) => {
      if (!cancelled) {
        onStateChange({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

  return () => {
    cancelled = true;
    releaseInlineImage(path);
  };
}

export function useInlineImage(path: string | null): InlineImageState {
  const client = useConnectionStore((s) => s.client);
  const daemon = useConnectionStore((s) => s.daemon);
  const [state, setState] = useState<InlineImageState>({ status: "idle" });

  useEffect(() => {
    const download = client && daemon ? (p: string) => transferFor(daemon).download(p) : null;
    return loadInlineImage(path, download, setState);
  }, [client, daemon, path]);

  return state;
}
