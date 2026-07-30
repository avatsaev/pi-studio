/**
 * Workspace context menu — Radix DropdownMenu anchored at cursor/button coordinates, mirroring
 * `SessionContextMenu.tsx`'s pattern. Opened via `WorkspaceGroupHeader`'s "⋮" button (a single
 * consolidated menu, replacing two always-visible icon buttons — file-explorer quick-wins-1).
 * Actions: New conversation, Delete workspace (all conversations — a real remote RPC per session,
 * `client.agent(id).delete()`; local state only drops after each one confirms).
 */

import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Plus, Trash2 } from "lucide-react";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useTabStore, tabIds, openNewChat } from "@pi-studio-ui/stores/tab-store.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { useHomeDir } from "@pi-studio-ui/hooks/use-home-dir.js";
import { normalizeCwd, workspaceLabel } from "./workspace-grouping.js";
import styles from "./SessionContextMenu.module.css";

export function WorkspaceContextMenu() {
  const menu = useUiStore((s) => s.workspaceMenu);
  const closeWorkspaceMenu = useUiStore((s) => s.closeWorkspaceMenu);
  const client = useConnectionStore((s) => s.client);
  const order = useSessionStore((s) => s.order);
  const sessions = useSessionStore((s) => s.sessions);
  const homeDir = useHomeDir();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(menu !== null);
  }, [menu]);

  if (!menu) return null;
  const groupSessions = order
    .map((id) => sessions[id])
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .filter((s) => normalizeCwd(s.cwd || "~", homeDir) === menu.cwd);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) closeWorkspaceMenu();
  }

  function newConversation() {
    if (!menu) return;
    closeWorkspaceMenu();
    openNewChat(menu.cwd);
  }

  async function deleteWorkspace() {
    if (!menu) return;
    const count = groupSessions.length;
    const confirmed = window.confirm(
      `Delete all ${count} conversation${count === 1 ? "" : "s"} in "${workspaceLabel(menu.cwd)}"? ` +
        "This deletes the conversations only — files on disk are untouched. This cannot be undone.",
    );
    if (!confirmed) return closeWorkspaceMenu();
    closeWorkspaceMenu();
    for (const session of groupSessions) {
      if (session.agentId && client) {
        try {
          await client.agent(session.agentId).delete();
        } catch (err) {
          window.alert(
            `Failed to delete "${session.title}": ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
      }
      useSessionStore.getState().remove(session.id);
      useTabStore.getState().close(tabIds.chat(session.id));
    }
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={styles.trigger}
          style={{ left: menu.x, top: menu.y }}
          aria-hidden
          tabIndex={-1}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.content} align="start" sideOffset={2}>
          <DropdownMenu.Item className={styles.item} onSelect={newConversation}>
            <Plus size={13} />
            New conversation
          </DropdownMenu.Item>
          <DropdownMenu.Separator className={styles.sep} />
          <DropdownMenu.Item
            className={`${styles.item} ${styles.danger}`}
            onSelect={deleteWorkspace}
          >
            <Trash2 size={13} />
            Delete workspace (all conversations)
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
