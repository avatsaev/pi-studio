/**
 * Bring the workspace that was in view back into view after a reload.
 *
 * Panes are restored per workspace, but *which* workspace the user was looking at is a separate fact,
 * and without it restore lands wherever the most recently active agent happens to live
 * (`use-session-restore.ts` activates `order[0]`, and every tab open brings its own workspace into
 * view). With two workspaces open that is a coin flip: the panes come back correctly and the user sees
 * the wrong ones — a bug that reads as "my layout was lost" until you click the other workspace and
 * watch the split appear intact.
 *
 * Waits for the **hydration settle point** rather than acting on the first arriving tab: tabs arrive
 * asynchronously and out of order, and any later `open()` would switch the view again — the last
 * writer has to be this one. At the settle point every tab that will arrive has arrived.
 *
 * Two conditions to switch, both about not lying to the user:
 * - the workspace still has a layout (its entry survived validation), and
 * - it has at least one live tab, so switching does not land on an empty workspace whose sessions were
 *   all deleted since the last load.
 *
 * clean-room-scope/features/workspace-split-panes.md § Restoring a persisted layout
 */

import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useTabStore, type ChatTabData } from "@pi-studio-ui/stores/tab-store.js";

/**
 * Watch for the settle point and restore the view once. Returns the unsubscribe, which is also called
 * automatically after the switch — this is a one-shot, so a later user-initiated workspace switch is
 * never undone.
 */
export function installActiveWorkspaceRestore(cwd: string | null): () => void {
  if (cwd === null) return () => {};
  if (isHydrated()) {
    restoreActiveWorkspace(cwd);
    return () => {};
  }
  const unsubscribe = useLayoutStore.subscribe(() => {
    if (!isHydrated()) return;
    unsubscribe();
    restoreActiveWorkspace(cwd);
  });
  return unsubscribe;
}

/** Exported for tests: the switch itself, with both guards. Returns whether it switched. */
export function restoreActiveWorkspace(cwd: string): boolean {
  if (useLayoutStore.getState().layouts[cwd] === undefined) return false;
  if (!useTabStore.getState().tabs.some((tab) => tab.workspaceCwd === cwd)) return false;
  const switched = useTabStore.getState().activeWorkspaceCwd !== cwd;
  if (switched) useTabStore.getState().switchWorkspace(cwd);
  adoptChatFromWorkspace(cwd);
  return switched;
}

/**
 * Keep the active conversation inside the workspace now in view.
 *
 * `switchWorkspace` already syncs it from the focused pane, but `syncActiveSession` deliberately
 * no-ops when that pane holds a terminal or a file — a terminal has no conversation, and blanking the
 * status bar would be worse. What it leaves behind, though, is whatever chat restore happened to open
 * last, which is frequently in a *different* workspace: the status bar would then report another
 * conversation's model, context, tokens and cost while the user looks at this one.
 *
 * Seeding this earlier does not work — every `open()` brings its own workspace into view and
 * re-activates its own chat, so any pre-tab seed is overwritten. This has to run after the last tab
 * has arrived, which is precisely the settle point.
 *
 * Runs even when the view did not change: the view being right already says nothing about the active
 * conversation, which `use-session-restore` seeds from a global winner.
 */
function adoptChatFromWorkspace(cwd: string): void {
  const local = useTabStore
    .getState()
    .tabs.filter((tab) => tab.workspaceCwd === cwd && tab.kind === "chat");
  if (local.length === 0) return; // nothing local to offer; leave the status bar as it is
  const active = useSessionStore.getState().activeSessionId;
  if (local.some((tab) => (tab.data as ChatTabData).sessionId === active)) return;
  // The focused pane is not a chat (or `switchWorkspace` would have picked it), so any local
  // conversation beats a foreign one; first in tab order keeps it deterministic.
  useSessionStore.getState().activate((local[0]!.data as ChatTabData).sessionId);
}

function isHydrated(): boolean {
  const { sessions, terminals } = useLayoutStore.getState().hydrationSources;
  return sessions && terminals;
}
