/**
 * ChangesPanel — right-sidebar Changes tab (POC `renderRightPanel` changes branch, chat.html
 * ~line 1028-1039, POC_TO_APP_PLAN_UI.md §4.7). A/M/D badges + file path; click opens a diff tab.
 * Subscribes to live checkout status for the currently active workspace (§4.7 follow-up:
 * workspace-scoped tabs) — the same signal every tab creation site uses.
 */

import { clsx } from "clsx";
import { useCheckoutStatus } from "@pi-studio-ui/hooks/use-checkout-status.js";
import { useGitStore } from "@pi-studio-ui/stores/git-store.js";
import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import styles from "./ChangesPanel.module.css";

const BADGE_LABEL: Record<"added" | "modified" | "deleted", string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

export function ChangesPanel() {
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
  const cwd = activeWorkspaceCwd || "~";

  useCheckoutStatus(cwd);
  const changes = useGitStore((s) => s.changes);
  const openTab = useTabStore((s) => s.open);

  function handleClick(path: string, staged: boolean) {
    openTab({
      id: tabIds.diff(path, staged),
      kind: "diff",
      label: path.split("/").pop() || path,
      closable: true,
      data: { path, staged },
      workspaceCwd: cwd,
    });
  }

  if (changes.length === 0) {
    return <div className={styles.emptyState}>No changes detected</div>;
  }

  return (
    <div className={styles.list}>
      <div className={styles.summary}>
        {changes.length} changed file{changes.length === 1 ? "" : "s"}
      </div>
      {changes.map((change, i) => (
        <div
          key={`${change.path}-${change.staged}-${i}`}
          className={styles.item}
          onClick={() => handleClick(change.path, change.staged)}
        >
          <span className={clsx(styles.badge, styles[change.status])}>
            {BADGE_LABEL[change.status]}
          </span>
          <span className={styles.name}>{change.path}</span>
        </div>
      ))}
    </div>
  );
}
