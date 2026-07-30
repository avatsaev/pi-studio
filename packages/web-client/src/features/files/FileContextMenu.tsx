/**
 * File row context menu — Radix DropdownMenu anchored at cursor/button coordinates, mirroring
 * `SessionContextMenu.tsx`'s pattern. Two variants share this one component/menu instance
 * (`ui-store.ts`'s `fileMenu.background` flag):
 *  - Row menu (background: false): Open (files only) / New File / New Folder (directories only) /
 *    Copy Absolute Path / Copy Relative Path / Download (files only) / Delete.
 *  - Empty-space menu (background: true, opened by right-clicking below the last row): New File /
 *    New Folder / Copy Current Directory Path / Copy Current Directory Relative Path — no
 *    Open/Download/Delete, since there's no specific row under the cursor.
 */

import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ExternalLink,
  FilePlus,
  FolderPlus,
  Copy,
  Download as DownloadIcon,
  Trash2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useExplorerStore } from "@pi-studio-ui/stores/explorer-store.js";
import { useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import { useFileTransfer } from "@pi-studio-ui/hooks/use-file-transfer.js";
import { copyText } from "@pi-studio-ui/lib/clipboard.js";
import { dirOf, relativeToRoot } from "@pi-studio-ui/lib/paths.js";
import { openFileTab } from "./open-file-tab.js";
import styles from "./FileContextMenu.module.css";

export function FileContextMenu() {
  const menu = useUiStore((s) => s.fileMenu);
  const closeFileMenu = useUiStore((s) => s.closeFileMenu);
  const client = useConnectionStore((s) => s.client);
  const startDraft = useExplorerStore((s) => s.startDraft);
  const rootPath = useExplorerStore((s) => s.rootPath);
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
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

  function openFile() {
    if (!menu) return;
    closeFileMenu();
    openFileTab(menu.path, activeWorkspaceCwd || "~");
  }

  async function copyAbsolutePath() {
    if (!menu) return;
    closeFileMenu();
    try {
      await copyText(menu.path);
    } catch {
      window.alert("Failed to copy to clipboard.");
    }
  }

  async function copyRelativePath() {
    if (!menu) return;
    closeFileMenu();
    try {
      await copyText(relativeToRoot(menu.path, rootPath) || "/");
    } catch {
      window.alert("Failed to copy to clipboard.");
    }
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
      useTabStore.getState().closeByPathPrefix(menu.path);
    } catch (err) {
      window.alert(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function startNew(kind: "file" | "directory") {
    if (!menu) return;
    const parent = menu.isDirectory ? menu.path : dirOf(menu.path);
    closeFileMenu();
    startDraft(parent, kind);
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
          {menu.background ? (
            <>
              <DropdownMenu.Item className={styles.item} onSelect={() => startNew("file")}>
                <FilePlus size={13} />
                New File
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.item} onSelect={() => startNew("directory")}>
                <FolderPlus size={13} />
                New Folder
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.sep} />
              <DropdownMenu.Item className={styles.item} onSelect={copyAbsolutePath}>
                <Copy size={13} />
                Copy Current Directory Path
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.item} onSelect={copyRelativePath}>
                <Copy size={13} />
                Copy Current Directory Relative Path
              </DropdownMenu.Item>
            </>
          ) : (
            <>
              {!menu.isDirectory && (
                <>
                  <DropdownMenu.Item className={styles.item} onSelect={openFile}>
                    <ExternalLink size={13} />
                    Open
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className={styles.sep} />
                </>
              )}
              {menu.isDirectory && (
                <>
                  <DropdownMenu.Item className={styles.item} onSelect={() => startNew("file")}>
                    <FilePlus size={13} />
                    New File
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={styles.item} onSelect={() => startNew("directory")}>
                    <FolderPlus size={13} />
                    New Folder
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className={styles.sep} />
                </>
              )}
              <DropdownMenu.Item className={styles.item} onSelect={copyAbsolutePath}>
                <Copy size={13} />
                Copy Absolute Path
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.item} onSelect={copyRelativePath}>
                <Copy size={13} />
                Copy Relative Path
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.sep} />
              {!menu.isDirectory && (
                <>
                  <DropdownMenu.Item className={styles.item} onSelect={download}>
                    <DownloadIcon size={13} />
                    Download
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className={styles.sep} />
                </>
              )}
              <DropdownMenu.Item className={`${styles.item} ${styles.danger}`} onSelect={remove}>
                <Trash2 size={13} />
                Delete
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
