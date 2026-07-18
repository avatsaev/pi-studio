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
import { ArrowUp, Folder } from "lucide-react";
import { Button, Dialog, DialogClose } from "@pi-studio-ui/components/primitives/index.js";
import { TextInput } from "@pi-studio-ui/components/primitives/TextInput.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import { normalizeCwd } from "@pi-studio-ui/features/sessions/workspace-grouping.js";
import { useExplorer } from "@pi-studio-ui/hooks/use-explorer.js";
import { useHomeDir } from "@pi-studio-ui/hooks/use-home-dir.js";
import { openWorkspace } from "@pi-studio-ui/features/sessions/open-workspace.js";
import styles from "./OpenWorkspaceDialog.module.css";

export function OpenWorkspaceDialog() {
  const open = useUiStore((s) => s.cwdPickerOpen);
  const closeDialog = useUiStore((s) => s.closeCwdPicker);
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
  const client = useConnectionStore((s) => s.client);
  const homeDir = useHomeDir();

  const [path, setPathState] = useState("/");
  const [inputValue, setInputValue] = useState("/");

  // Seed the picker at the workspace currently in view each time it opens.
  useEffect(() => {
    if (!open) return;
    const seed = normalizeCwd(activeWorkspaceCwd || "~", homeDir);
    setPathState(seed);
    setInputValue(seed);
  }, [open, client, activeWorkspaceCwd]);

  const { data, isLoading, isError, error } = useExplorer(path, open && Boolean(client));
  const dirEntries = (data?.entries ?? []).filter((e) => e.kind === "directory");

  function navigate(next: string) {
    setPathState(next);
    setInputValue(next);
  }

  function handleUp() {
    navigate(path.split("/").slice(0, -1).join("/") || "/");
  }

  function handleGo() {
    navigate(inputValue.trim());
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
      </div>
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
