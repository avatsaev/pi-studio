/**
 * Shared "open a workspace" resolver for the folder-picker dialog: given a target cwd, either
 * activates the workspace's most recently active existing session, or creates a fresh one —
 * avoids piling up duplicate sessions when the user re-opens a folder they already have a chat
 * in. Distinct from `SessionList`'s "+ New conversation", which always starts a brand-new
 * session by design (POC_TO_APP_PLAN_UI.md §4.3 workspace grouping, §4.7 follow-up: open-workspace
 * dialog).
 */

import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { groupSessionsByWorkspace } from "./workspace-grouping.js";

/**
 * Resolve `cwd` (already tilde/absolute-normalized by the caller, e.g. via `resolveTildePath`) to
 * a session: reuses the workspace's most recent session if one already exists at that cwd,
 * otherwise creates a new one. Activates the session and opens/focuses its chat tab. Also seeds
 * `useUiStore().cwd` so a subsequent bare "+ New conversation" defaults to this workspace.
 *
 * `homeDir` MUST be the same value the sidebar's grouping uses (`useHomeDir()`), so this matches
 * the exact workspace bucket a tilde-form and absolute-form cwd would collapse into — reusing a
 * different normalization here would resurrect the tilde/absolute duplicate-workspace bug.
 */
export function openWorkspace(cwd: string, homeDir: string | null): void {
  const { order, sessions, createSession, activate } = useSessionStore.getState();

  const groups = groupSessionsByWorkspace(order, sessions, homeDir);
  const existing = groups.find((g) => g.cwd === cwd);

  const sessionId = existing?.sessions[0]?.id ?? createSession(cwd);
  activate(sessionId);

  const session = useSessionStore.getState().sessions[sessionId];
  useTabStore.getState().open({
    id: tabIds.chat(sessionId),
    kind: "chat",
    label: session?.title ?? "New chat",
    closable: true,
    data: { sessionId },
    workspaceCwd: cwd,
  });

  useUiStore.getState().setCwd(cwd);
}
