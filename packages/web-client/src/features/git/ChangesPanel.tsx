/**
 * ChangesPanel — right-sidebar Changes tab (POC `renderRightPanel` changes branch, chat.html
 * ~line 1028-1039, POC_TO_APP_PLAN_UI.md §4.7). A/M/D badges + file path; click opens a diff tab.
 * A pure `git-store` consumer — the live checkout-status subscription for the active workspace is
 * owned solely by `StatusBar` (sprint-042; it is always mounted, unlike this panel, which only
 * exists while the Changes tab is selected). Two independent `useCheckoutStatus(cwd)` callers on
 * the same cwd would collide: the daemon's `checkout_status_subscribe`/`_unsubscribe` handlers key
 * on a flat `session:cwd` map (`packages/server/src/projects/git-checkout-rpc.ts`), not
 * reference-counted, so whichever hook instance unmounts first (e.g. switching away from this
 * tab) would silently kill the *other* instance's live feed too.
 */

import { clsx } from "clsx";
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
