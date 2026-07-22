/**
 * File row context menu — Radix DropdownMenu anchored at cursor/button coordinates, mirroring
 * `SessionContextMenu.tsx`'s pattern. Opened via a per-row "⋮" button or right-click. Actions:
 * download (save-to-disk, files only) and delete (files + directories, recursive, confirmed).
 */

import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useFileTransfer } from "@pi-studio-ui/hooks/use-file-transfer.js";
import styles from "./FileContextMenu.module.css";

export function FileContextMenu() {
  const menu = useUiStore((s) => s.fileMenu);
  const closeFileMenu = useUiStore((s) => s.closeFileMenu);
  const client = useConnectionStore((s) => s.client);
  const { saveToDisk } = useFileTransfer();
  const queryClient = useQueryClient();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(menu !== null);
  }, [menu]);

  if (!menu) return null;
  const name = menu.path.split("/").pop() || menu.path;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) closeFileMenu();
  }

  async function download() {
    if (!menu) return;
    closeFileMenu();
    try {
      await saveToDisk(menu.path);
    } catch (err) {
      window.alert(`Failed to download: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function remove() {
    if (!menu) return;
    const kind = menu.isDirectory ? "folder (and everything inside it)" : "file";
    if (!window.confirm(`Permanently delete this ${kind}? "${name}" — this cannot be undone.`)) {
      return closeFileMenu();
    }
    closeFileMenu();
    if (!client) {
      window.alert("Not connected — cannot delete remotely.");
      return;
    }
    try {
      const response = await client.connection.request<{ ok: boolean; error?: string }>(
        "file_delete_request",
        { path: menu.path },
      );
      if (!response.ok) throw new Error(response.error ?? "delete failed");
      await queryClient.invalidateQueries({ queryKey: ["explorer"] });
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
          {!menu.isDirectory && (
            <DropdownMenu.Item className={styles.item} onSelect={download}>
              Download
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className={styles.sep} />
          <DropdownMenu.Item className={`${styles.item} ${styles.danger}`} onSelect={remove}>
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
