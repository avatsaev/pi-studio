/**
 * Session context menu — Radix DropdownMenu anchored at cursor coordinates, replacing the POC's
 * manually-positioned `#session-menu` (POC_TO_APP_PLAN_UI.md §4.7). Actions: rename
 * (`update_agent` labels), stop (`interrupt_agent`), archive (`archive_agent` — soft delete, keeps
 * the record for resume), delete (`delete_agent` — hard delete, no trace). Both archive and delete
 * are real remote RPCs: local session/tab state is only removed after the daemon confirms, so a
 * failure (disconnected, agent already gone, etc.) surfaces instead of silently leaving the record
 * on disk while the UI pretends it's gone.
 */

import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Pencil, Square, Archive as ArchiveIcon, GitFork, Trash2 } from "lucide-react";
import { MenuCursorTrigger, MenuContent, MenuItem, MenuSeparator } from "@av-pi-studio/ui-library";
import { getHost } from "../../host/install.js";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { useSessionRenameStore } from "../../stores/session-rename-store.js";
import { useSessionStore } from "../../stores/session-store.js";
import { useTabStore, tabIds } from "../../stores/tab-store.js";
import { useUiStore } from "../../stores/ui-store.js";
import { useForkMenu } from "../chat/use-fork-action.js";

export function SessionContextMenu() {
  const menu = useUiStore((s) => s.sessionMenu);
  const closeSessionMenu = useUiStore((s) => s.closeSessionMenu);
  const client = useConnectionStore((s) => s.client);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(menu !== null);
  }, [menu]);

  const session = useSessionStore((s) => (menu ? s.sessions[menu.sessionId] : undefined));
  // Called unconditionally (rules-of-hooks) — `session` may be undefined until `menu` resolves,
  // which `useCanFork`/`useForkMenu` handle by gating false rather than requiring a guard here.
  const fork = useForkMenu(session);

  if (!menu) return null;
  const canStop = Boolean(session?.agentId) && session?.status === "running";

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) closeSessionMenu();
  }

  function rename() {
    if (!session) return;
    useSessionRenameStore.getState().open(session.id);
    closeSessionMenu();
  }

  function stop() {
    if (session?.agentId)
      void client
        ?.agent(session.agentId)
        .interrupt()
        .catch(() => {});
    closeSessionMenu();
  }

  /** Remove the session/tab from local state only — called after a confirmed remote success, or
   * directly for a session with no `agentId` (never sent a message, nothing exists server-side). */
  function removeLocal(sessionId: string) {
    useSessionStore.getState().remove(sessionId);
    useTabStore.getState().close(tabIds.chat(sessionId));
  }

  async function archive() {
    if (!session) return;
    if (!(await getHost().dialogs.confirm("Archive this agent? It can be resumed later.")))
      return closeSessionMenu();
    closeSessionMenu();
    if (!session.agentId) {
      removeLocal(session.id);
      return;
    }
    if (!client) {
      await getHost().dialogs.alert("Not connected — cannot archive remotely.");
      return;
    }
    try {
      await client.agent(session.agentId).archive();
      removeLocal(session.id);
    } catch (err) {
      await getHost().dialogs.alert(
        `Failed to archive: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function remove() {
    if (!session) return;
    if (
      !(await getHost().dialogs.confirm("Permanently delete this agent? This cannot be undone."))
    ) {
      return closeSessionMenu();
    }
    closeSessionMenu();
    if (!session.agentId) {
      removeLocal(session.id);
      return;
    }
    if (!client) {
      await getHost().dialogs.alert("Not connected — cannot delete remotely.");
      return;
    }
    try {
      await client.agent(session.agentId).delete();
      removeLocal(session.id);
    } catch (err) {
      await getHost().dialogs.alert(
        `Failed to delete: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>
        <MenuCursorTrigger ref={triggerRef} x={menu.x} y={menu.y} />
      </DropdownMenu.Trigger>
      <MenuContent minWidth={160}>
        <MenuItem onSelect={rename}>
          <Pencil size={13} />
          Rename
        </MenuItem>
        <MenuItem disabled={!canStop} onSelect={stop}>
          <Square size={13} />
          Stop agent
        </MenuItem>
        {fork.canFork && (
          <MenuItem onSelect={fork.openForkPicker}>
            <GitFork size={13} />
            Fork from…
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem danger onSelect={archive}>
          <ArchiveIcon size={13} />
          Archive
        </MenuItem>
        <MenuItem danger onSelect={remove}>
          <Trash2 size={13} />
          Delete permanently
        </MenuItem>
      </MenuContent>
    </DropdownMenu.Root>
  );
}
