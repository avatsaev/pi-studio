/**
 * OpenWorkspaceDialog — directory browser for opening a new workspace (evolved from the POC
 * `#cwd-overlay`, chat.html ~line 328-336, 1122-1141; POC_TO_APP_PLAN_UI.md §4.7 follow-up:
 * toolbar "Open Workspace" button). Built on the generic `Dialog` primitive
 * (`components/primitives/Dialog.tsx`) — this file owns only the address input + Go/Up buttons +
 * directory list body. "Open" resolves the selected path to a session via `openWorkspace()` —
 * reusing the workspace's most recent existing session if one is already open there, else
 * creating a new one — then closes.
 */

import { useEffect, useState } from "react";
import { ArrowUp, Folder, FolderPlus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, DialogClose } from "@pi-studio-ui/components/primitives/index.js";
import { TextInput } from "@pi-studio-ui/components/primitives/TextInput.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import { normalizeCwd } from "@pi-studio-ui/features/sessions/workspace-grouping.js";
import { useExplorer } from "@pi-studio-ui/hooks/use-explorer.js";
import { useHomeDir } from "@pi-studio-ui/hooks/use-home-dir.js";
import { openWorkspace } from "@pi-studio-ui/features/sessions/open-workspace.js";
import { createEntry } from "@pi-studio-ui/features/files/create-entry.js";
import styles from "./OpenWorkspaceDialog.module.css";

export function OpenWorkspaceDialog() {
  const open = useUiStore((s) => s.cwdPickerOpen);
  const closeDialog = useUiStore((s) => s.closeCwdPicker);
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
  const uiCwd = useUiStore((s) => s.cwd);
  const client = useConnectionStore((s) => s.client);
  const homeDir = useHomeDir();

  const [path, setPathState] = useState("/");
  const [inputValue, setInputValue] = useState("/");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const queryClient = useQueryClient();

  // Seed the picker at the workspace currently in view each time it opens. Falls back to the
  // `?cwd=` deep-link param / last-opened workspace (`ui-store.cwd`), then home.
  useEffect(() => {
    if (!open) return;
    const seed = normalizeCwd(activeWorkspaceCwd || uiCwd || "~", homeDir);
    setPathState(seed);
    setInputValue(seed);
    resetCreate();
  }, [open, client, activeWorkspaceCwd, uiCwd]);

  const { data, isLoading, isError, error } = useExplorer(path, open && Boolean(client));
  const dirEntries = (data?.entries ?? []).filter((e) => e.kind === "directory");

  function resetCreate() {
    setCreating(false);
    setNewName("");
    setCreateError(null);
  }

  function navigate(next: string) {
    setPathState(next);
    setInputValue(next);
    resetCreate();
  }

  function handleUp() {
    navigate(path.split("/").slice(0, -1).join("/") || "/");
  }

  function handleGo() {
    navigate(inputValue.trim());
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name || !client || createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await createEntry(client, path, name, "directory");
      await queryClient.invalidateQueries({ queryKey: rpcKeys.explorer(path) });
      navigate(created); // also resets the draft state
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create folder");
    } finally {
      setCreateBusy(false);
    }
  }

  function handleOpen() {
    openWorkspace(path, homeDir);
    closeDialog();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && closeDialog()}
      title="Open Workspace"
      footer={
        <>
          <DialogClose asChild>
            <Button size="sm" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button size="sm" onClick={handleOpen}>
            Open this folder
          </Button>
        </>
      }
    >
      <div className={styles.pathRow}>
        <Button size="xs" variant="ghost" iconOnly title="Up" onClick={handleUp}>
          <ArrowUp size={13} />
        </Button>
        <TextInput
          className={styles.pathInput}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleGo();
            }
          }}
        />
        <Button size="xs" onClick={handleGo}>
          Go
        </Button>
        <Button
          size="xs"
          variant="ghost"
          iconOnly
          title="New folder"
          disabled={!client || isError || creating}
          onClick={() => {
            setCreating(true);
            setNewName("");
            setCreateError(null);
          }}
        >
          <FolderPlus size={13} />
        </Button>
      </div>
      {creating && (
        <>
          <div className={styles.createRow}>
            <Folder size={14} />
            <TextInput
              className={styles.createInput}
              autoFocus
              placeholder="New folder name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreate();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  resetCreate();
                }
              }}
            />
            <Button
              size="xs"
              loading={createBusy}
              disabled={!newName.trim() || createBusy}
              onClick={() => void handleCreate()}
            >
              Create
            </Button>
            <Button size="xs" variant="secondary" onClick={resetCreate}>
              Cancel
            </Button>
          </div>
          {createError && <div className={styles.createError}>{createError}</div>}
        </>
      )}
      <div className={styles.list}>
        {isLoading ? (
          <div className={styles.emptyState}>Loading...</div>
        ) : isError ? (
          <div className={styles.emptyState}>
            Error: {error instanceof Error ? error.message : "unknown error"}
          </div>
        ) : dirEntries.length === 0 ? (
          <div className={styles.emptyState}>No subdirectories</div>
        ) : (
          dirEntries.map((entry) => (
            <div
              key={entry.name}
              className={styles.item}
              onClick={() => navigate(path === "/" ? `/${entry.name}` : `${path}/${entry.name}`)}
            >
              <Folder size={14} />
              <span className={styles.name}>{entry.name}</span>
            </div>
          ))
        )}
      </div>
    </Dialog>
  );
}
