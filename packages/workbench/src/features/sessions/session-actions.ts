/**
 * The sidebar context menus' dialog-gated actions, outside React so they run (and are tested)
 * against whatever host is installed. Each asks through `getHost().dialogs` and only mutates after
 * the user agreed.
 */

import type { PiStudioClient } from "@av-pi-studio/client";
import { getHost } from "../../host/install.js";
import { type SessionEntry, useSessionStore } from "../../stores/session-store.js";
import { tabIds, useTabStore } from "../../stores/tab-store.js";
import { workspaceLabel } from "./workspace-grouping.js";

type SessionRef = Pick<SessionEntry, "id" | "title" | "agentId">;
type AgentClient = Pick<PiStudioClient, "agent">;

/** Prompt for a new title; a dismissed or blank answer changes nothing. */
export async function renameSession(
  session: SessionRef,
  client: AgentClient | null,
): Promise<void> {
  const next = await getHost().dialogs.prompt("Rename:", session.title);
  if (!next?.trim()) return;
  const title = next.trim();
  useSessionStore.getState().setTitle(session.id, title);
  useTabStore.getState().updateLabel(tabIds.chat(session.id), title);
  if (session.agentId)
    void client
      ?.agent(session.agentId)
      .update({ title })
      .catch(() => {});
}

/**
 * Ask, then delete every conversation of a workspace (files on disk are untouched). Returns whether
 * the user confirmed. A failed delete is reported and skipped; the rest continue.
 */
export async function deleteWorkspaceConversations(
  cwd: string,
  sessions: readonly SessionRef[],
  client: AgentClient | null,
  onConfirmed: () => void,
): Promise<boolean> {
  const count = sessions.length;
  const confirmed = await getHost().dialogs.confirm(
    `Delete all ${count} conversation${count === 1 ? "" : "s"} in "${workspaceLabel(cwd)}"? ` +
      "This deletes the conversations only — files on disk are untouched. This cannot be undone.",
  );
  if (!confirmed) return false;
  onConfirmed();
  for (const session of sessions) {
    if (session.agentId && client) {
      try {
        await client.agent(session.agentId).delete();
      } catch (err) {
        await getHost().dialogs.alert(
          `Failed to delete "${session.title}": ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
    }
    useSessionStore.getState().remove(session.id);
    useTabStore.getState().close(tabIds.chat(session.id));
  }
  return true;
}
