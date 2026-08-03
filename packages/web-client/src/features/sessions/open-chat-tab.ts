/**
 * Shared "open a session as a chat tab" dispatch — the sibling of `features/files/open-file-tab.ts`,
 * and for the same reason: the tab id, label and normalized `workspaceCwd` must be identical no
 * matter which entry point opens the conversation, because `tabIdentity` keys the persisted pane
 * layout off them. Three call sites had grown their own copy of this object literal (the sidebar row
 * click, the connect-time restore, and now a sidebar-to-pane drag); a fourth would have been a fourth
 * chance to drift.
 *
 * `targetPaneId` places the tab in a named pane, exactly as `openNewChat`/`openFileTab` accept it;
 * omitted, the tab lands in the focused pane.
 */

import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import type { SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { normalizeCwd } from "./workspace-grouping.js";

export function openChatTab(
  session: SessionEntry,
  homeDir: string | null,
  targetPaneId?: string,
): void {
  useTabStore.getState().open(
    {
      id: tabIds.chat(session.id),
      kind: "chat",
      label: session.title || "Chat",
      closable: true,
      data: { sessionId: session.id },
      workspaceCwd: normalizeCwd(session.cwd || "~", homeDir),
    },
    targetPaneId,
  );
}
