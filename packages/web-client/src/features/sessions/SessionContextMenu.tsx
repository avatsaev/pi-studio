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
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { useSessionStore } from "../../stores/session-store.js";
import { useTabStore, tabIds } from "../../stores/tab-store.js";
import { useUiStore } from "../../stores/ui-store.js";
import styles from "./SessionContextMenu.module.css";

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

  if (!menu) return null;
  const canStop = Boolean(session?.agentId) && session?.status === "running";

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) closeSessionMenu();
  }

  function rename() {
    if (!session) return;
    const next = window.prompt("Rename:", session.title);
    if (next?.trim()) {
      const title = next.trim();
      useSessionStore.getState().setTitle(session.id, title);
      useTabStore.getState().updateLabel(tabIds.chat(session.id), title);
      if (session.agentId) void client?.agent(session.agentId).update({ title }).catch(() => {});
    }
    closeSessionMenu();
  }

  function stop() {
    if (session?.agentId) void client?.agent(session.agentId).interrupt().catch(() => {});
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
    if (!window.confirm("Archive this agent? It can be resumed later.")) return closeSessionMenu();
    closeSessionMenu();
    if (!session.agentId) {
      removeLocal(session.id);
      return;
    }
    if (!client) {
      window.alert("Not connected — cannot archive remotely.");
      return;
    }
    try {
      await client.agent(session.agentId).archive();
      removeLocal(session.id);
    } catch (err) {
      window.alert(`Failed to archive: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function remove() {
    if (!session) return;
    if (!window.confirm("Permanently delete this agent? This cannot be undone.")) {
      return closeSessionMenu();
    }
    closeSessionMenu();
    if (!session.agentId) {
      removeLocal(session.id);
      return;
    }
    if (!client) {
      window.alert("Not connected — cannot delete remotely.");
      return;
    }
    try {
      await client.agent(session.agentId).delete();
      removeLocal(session.id);
    } catch (err) {
      window.alert(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
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
          <DropdownMenu.Item className={styles.item} onSelect={rename}>
            Rename
          </DropdownMenu.Item>
          <DropdownMenu.Item className={styles.item} disabled={!canStop} onSelect={stop}>
            Stop agent
          </DropdownMenu.Item>
          <DropdownMenu.Separator className={styles.sep} />
          <DropdownMenu.Item className={`${styles.item} ${styles.danger}`} onSelect={archive}>
            Archive
          </DropdownMenu.Item>
          <DropdownMenu.Item className={`${styles.item} ${styles.danger}`} onSelect={remove}>
            Delete permanently
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
