/**
 * `use-file-live-refresh` — watches a file tab's OWN file (via `useFileWatch`/`watchFile`) and
 * invalidates that path's content queries on every `file_changed` push, so a `kind:"file"` or
 * `kind:"diff"` tab refetches from disk within ~1s of an external change — an editor, a shell
 * command, a build step, or `git` run in a terminal — not just a Pi tool call completing
 * (`lib/connection/files-changed.ts`'s existing debounced post-tool-call invalidation, which stays
 * as the belt-and-braces path for files nobody has open).
 *
 * `LIVE_REFRESH_KINDS` is the scope gate: only `"text"`, `"markdown"`, and `"image"` tabs watch.
 * `"video"` is excluded because a refetch mints a new object URL, which restarts playback from
 * zero mid-watch; `"binary"` fetches nothing at all until the user clicks its Download button, so
 * there is nothing to refresh. Exported so the gate itself is unit-testable — a new `ViewerKind`
 * must make an explicit choice here, not inherit one.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";
import type { ViewerKind } from "@pi-studio-ui/features/files/viewer-registry.js";
import { useFileWatch } from "./use-file-watch.js";

export const LIVE_REFRESH_KINDS: ReadonlySet<ViewerKind> = new Set(["text", "markdown", "image"]);

/**
 * Absolute watch target for a tab path. A `kind:"file"` tab already carries an absolute path
 * (the explorer root is tilde-resolved via `resolveTildePath`, `FileExplorer.tsx:67`); a
 * `kind:"diff"` tab carries git's REPO-RELATIVE path plus the workspace cwd
 * (`features/git/ChangesPanel.tsx:37`), so it must be joined here. A leading `~` is left alone —
 * the daemon expands it and `watchFile`'s resolved-path matching (task-007/step 1) covers it.
 */
export function watchTargetPath(path: string, cwd: string): string | null {
  if (!path) return null;
  if (path.startsWith("/") || path.startsWith("~")) return path;
  if (!cwd) return null;
  return `${cwd.replace(/\/+$/, "")}/${path}`;
}

/**
 * Invalidates `path`'s `fileRead`/`fileDownload`/`fileDiffByPath` queries on every `file_changed`
 * push for the WATCHED (resolved absolute) target — these differ for a diff tab, which is why
 * both `path` and `cwd` are taken separately. All three keys are invalidated unconditionally: a
 * watched tab can be showing any of them (`fileRead` → `TextViewer` tier 1 + `MarkdownFileViewer`;
 * `fileDownload` → `ImageViewer` and `TextViewer`'s tier-2 streamed source; `fileDiffByPath` →
 * `DiffView`, reachable from both tab kinds through `FilePanel`'s File/Diff toggle). Invalidating a
 * key with no live query is a no-op, so only *whether to watch* branches on `viewerKind`, never
 * the invalidation list.
 *
 * No client-side debounce: the daemon already coalesces at `FILE_WATCH_COALESCE_MS` (150ms). A
 * deleted file pushes too — the refetch then fails and the viewer shows its existing error state,
 * which is the correct observable outcome; no special-casing.
 */
export function useFileLiveRefresh(path: string, cwd: string, viewerKind: ViewerKind): void {
  const queryClient = useQueryClient();
  // A `null` target subscribes nothing (`useFileWatch`'s documented no-op), so an excluded kind
  // costs zero daemon watches rather than watching and then discarding the push.
  const target = LIVE_REFRESH_KINDS.has(viewerKind) ? watchTargetPath(path, cwd) : null;
  const { changedAt } = useFileWatch(target);

  useEffect(() => {
    if (changedAt === null) return;
    void queryClient.invalidateQueries({ queryKey: rpcKeys.fileRead(path) });
    void queryClient.invalidateQueries({ queryKey: rpcKeys.fileDownload(path) });
    void queryClient.invalidateQueries({ queryKey: rpcKeys.fileDiffByPath(path) });
  }, [changedAt, path, queryClient]);
}
