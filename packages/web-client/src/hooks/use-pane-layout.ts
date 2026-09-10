/**
 * Pane-layout boot: install the persisted pane geometry, wire the write triggers, and flush on
 * `pagehide`.
 *
 * Ordering matters and is the reason this is a hook rather than a module side effect. The persisted
 * geometry must be installed *before* the restore hooks open their first tab, because every arrival
 * consumes its pane claim on the way in (`layout-store.claimPaneFor`) — a tab that arrives before
 * the claims exist lands in the default pane and the layout is lost. Both restore hooks only fire
 * once the connection reports `open`, i.e. a later commit than this mount effect, so "install first"
 * holds without any coordination between them.
 *
 * The record also carries the **client-side** tabs — files, diffs, molecule views — which no daemon
 * inventory can rebuild, so `reopenClientTabs` replays them. That replay waits for the connection to
 * report `open`, even though it needs no RPC of its own: reopening tabs is what brings a workspace
 * into view, and doing it at mount put a full split layout with file tabs on screen behind the
 * connect form, before there was any daemon to load them from. Restoring the UI is only meaningful
 * once there is a daemon behind it, which is the same rule the two daemon restores follow.
 *
 * It still runs before either of them: all three effects live in one component (`app.tsx`'s `Boot`),
 * so they fire in hook-declaration order within the same commit, and this one is declared first.
 * Once per page load, not per connection — the tabs stay open across a reconnect, and replaying would
 * re-activate them and yank the user's focus.
 *
 * `installPaneLayoutPersistence` is wired *after* the install so it does not schedule a write of the
 * state it just read. Writes that land before hydration settles are safe regardless: they preserve
 * unconsumed claims (see `pane-layout-persistence.ts`'s `writePaneLayout`).
 *
 * swe/features/workspace-split-panes.md § Restoring a persisted layout
 */

import { useEffect, useRef } from "react";
import {
  flushPaneLayoutWrite,
  installPaneLayoutPersistence,
  loadPaneLayout,
  type LoadedPaneLayout,
} from "@pi-studio-ui/lib/pane-layout-persistence.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { reopenClientTabs } from "@pi-studio-ui/features/workspace/reopen-client-tabs.js";
import { installActiveWorkspaceRestore } from "@pi-studio-ui/features/workspace/restore-active-workspace.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useViewerSettingsStore } from "@pi-studio-ui/viewer-plugins/viewer-settings-store.js";

const EMPTY_RECORD: LoadedPaneLayout = { workspaces: new Map(), activeWorkspaceCwd: null };

/**
 * Whether the replay effect should run now. Pure — extracted for direct unit testing (no jsdom
 * test environment in this repo; `hooks/file-text-state.ts`'s identical rationale). The replay
 * waits on BOTH `status === "open"` and `loaded` (the viewer-settings store's hydration flag): a
 * persisted `molecule:<path>` identity must not race the settings fetch and reopen as a molecule
 * tab the user disabled. `replayed` makes it a one-shot regardless of how many times either input
 * changes afterward.
 */
export function shouldReplayPaneLayout(
  status: string,
  viewerSettingsLoaded: boolean,
  replayed: boolean,
): boolean {
  return status === "open" && viewerSettingsLoaded && !replayed;
}

export function usePaneLayoutBoot(): void {
  const status = useConnectionStore((s) => s.status);
  // `loaded` is a store selector, not a `getState()` read inside the `[status]` effect below —
  // only a subscribed value re-runs the effect when the settings fetch resolves later than the
  // connection status transition (see `shouldReplayPaneLayout` for the full gate rationale).
  const viewerSettingsLoaded = useViewerSettingsStore((s) => s.loaded);
  const loadedRef = useRef<LoadedPaneLayout>(EMPTY_RECORD);
  const replayedRef = useRef(false);

  useEffect(() => {
    const loaded = loadPaneLayout();
    loadedRef.current = loaded;
    useLayoutStore.getState().installPersistedLayouts(loaded.workspaces, loaded.activeWorkspaceCwd);
    const uninstall = installPaneLayoutPersistence();
    // A reload inside the write debounce would otherwise drop the last mutation — a divider drag
    // followed immediately by Cmd+R being the obvious way to notice.
    const flush = () => flushPaneLayoutWrite();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      uninstall();
    };
  }, []);

  useEffect(() => {
    if (!shouldReplayPaneLayout(status, viewerSettingsLoaded, replayedRef.current)) return;
    replayedRef.current = true;
    const loaded = loadedRef.current;
    reopenClientTabs(loaded.workspaces);
    // Armed only now: the settle point can only be reached once the restores are running, and arming
    // at mount would watch for a hydration cycle that a later `installPersistedLayouts` resets anyway.
    installActiveWorkspaceRestore(loaded.activeWorkspaceCwd);
  }, [status, viewerSettingsLoaded]);
}
