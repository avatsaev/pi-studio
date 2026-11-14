/**
 * `filesChanged` signal — invalidates the file/diff/explorer query caches after a completed
 * write/edit/shell tool call (POC `scheduleFileRefresh`/`reloadOpenFileTabs`, chat.html
 * ~line 1070-1092, POC_TO_APP_PLAN_UI.md §4.3/§4.5/§5). Debounced ~500ms to coalesce a burst of
 * tool completions (POC used `setTimeout(...,600)`/`400`).
 *
 * As of task-006/008, the daemon ALSO pushes `file_changed` directly for any expanded directory
 * (`use-explorer-watch.ts`, a real `fs.watch`-backed daemon push) — covering non-agent filesystem
 * changes (an external editor, a shell command run outside the tool-call path, `git` in a
 * pi-studio terminal) that this debounced post-tool invalidation cannot see at all, since it only
 * fires from the timeline reducer's own `tool_call` completions. This module remains as the
 * belt-and-braces path for two things directory watching does NOT cover: it also invalidates
 * `["file"]` *content* queries (an open text tab's read cache), and it covers a tool completion
 * even when the affected directory happens not to be expanded in the tree right now. The daemon's
 * 150ms coalescing (task-006) sits well under this module's 500ms debounce, so the two paths
 * cannot thrash each other.
 *
 * The daemon does NOT push a `checkout_status_update` automatically after a git-affecting tool
 * completion, so this module also fires an explicit `checkout_refresh_request` for the active
 * cwd — `ChangesPanel`/`FileExplorer` then pick up the resulting push/refetch reactively, since
 * they're already subscribed (`use-checkout-status.ts`) or query-cache-driven (`use-explorer.ts`).
 *
 * NOTE (follow-up, cross-slice): this module only *exports* the invalidation function. The actual
 * call site — wiring this into the timeline reducer's `tool_call` handling on `status:"completed"`
 * for `toolMutatesFiles(tool) === true` — belongs to the chat/session-store slice (built in
 * parallel) or the top-level app wiring; do not import/call it from `timeline/reducer.ts` here,
 * that file is a shared contract file owned across slices.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { PiStudioClient } from "@av-pi-studio/client";

const DEBOUNCE_MS = 500;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Invalidate file/diff/explorer TanStack Query caches and refresh git status for `cwd`.
 * Debounced: repeated calls within `DEBOUNCE_MS` coalesce into a single invalidation pass.
 *
 * `toolFilePath` is accepted for future path-scoped invalidation (POC `reloadOpenFileTabs`
 * matched by path suffix) but the current pass invalidates the whole `file`/`explorer` query
 * families — TanStack Query dedupes refetches for inactive queries, so this is cheap and correct
 * even when the path is unknown.
 */
export function invalidateAfterToolCompletion(
  queryClient: QueryClient,
  client: PiStudioClient | null,
  cwd: string | null,
  _toolFilePath: string | null,
): void {
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = undefined;
    void queryClient.invalidateQueries({ queryKey: ["file"] });
    void queryClient.invalidateQueries({ queryKey: ["explorer"] });
    if (client && cwd) {
      void client.connection.request("checkout_refresh_request", { cwd }).catch(() => {});
    }
  }, DEBOUNCE_MS);
}
