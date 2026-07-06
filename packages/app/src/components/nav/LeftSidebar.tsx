/**
 * LeftSidebar — persistent navigation chrome.
 * Consumes sprint-013 sidebar view model + connection store.
 * app-navigation-screens.md § Left sidebar
 */

import { useLocation, useNavigate } from "react-router";
import { clsx } from "clsx";
import { Home, Calendar, Settings, Plus, FolderOpen, X } from "lucide-react";
import styles from "./LeftSidebar.module.css";
import { groupWorkspaces, type WorkspaceRow } from "../../screens/sidebar.js";
import { StatusDot } from "../primitives/StatusDot.js";
import { type HostRuntimeSnapshot } from "../../runtime/host-runtime.js";
import { routes } from "../../runtime/route-grammar.js";

export interface LeftSidebarProps {
  /** All known hosts (for the host switcher). */
  hosts: readonly HostRuntimeSnapshot[];
  /** The active host in context (path-derived). */
  activeHost?: HostRuntimeSnapshot;
  workspaces: readonly WorkspaceRow[];
  /** overlay = compact absolute; pinned = side column; hidden = no sidebar. */
  mode: "pinned" | "overlay" | "hidden";
  onClose?: () => void;
  onNewWorkspace?: () => void;
  onOpenCommandCenter?: () => void;
  groupBy?: "project" | "recent";
}

export function LeftSidebar({
  hosts,
  activeHost,
  workspaces,
  mode,
  onClose,
  onNewWorkspace,
  groupBy = "project",
}: LeftSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const groups = groupWorkspaces(workspaces, groupBy);

  if (mode === "hidden") return null;

  const sidebar = (
    <aside
      className={clsx(
        styles.sidebar,
        mode === "overlay" && styles.sidebarOverlay,
      )}
      data-sidebar
    >
      {/* Header: host label + close (overlay only) */}
      <div className={styles.sidebarHeader}>
        <span className={styles.hostLabel}>
          {activeHost?.profile.label ?? "Pi-Studio"}
        </span>
        {mode === "overlay" && onClose && (
          <button className={styles.footerBtn} onClick={onClose} aria-label="Close sidebar">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Grouped workspace list */}
      <div className={styles.workspaceList} role="navigation" aria-label="Workspaces">
        {groups.map((g) => (
          <div key={g.key}>
            {g.label !== "Recent" && (
              <div className={styles.groupLabel}>{g.label}</div>
            )}
            {g.rows.map((row) => (
              <button
                key={row.workspaceId}
                className={styles.workspaceRow}
                onClick={() => {
                  if (activeHost?.serverId) {
                    navigate(routes.workspace(activeHost.serverId, row.workspaceId));
                    if (mode === "overlay") onClose?.();
                  }
                }}
                title={row.label}
              >
                <span className={styles.workspaceRowLabel}>{row.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Footer actions */}
      <div className={styles.footer}>
        <button
          className={styles.footerBtn}
          onClick={() => navigate(routes.openProject())}
          aria-label="Home"
          title="Home"
        >
          <Home size={16} />
        </button>
        <button
          className={styles.footerBtn}
          onClick={() => navigate(routes.schedules())}
          aria-label="Schedules"
          title="Schedules"
        >
          <Calendar size={16} />
        </button>
        <button
          className={styles.footerBtn}
          onClick={() => navigate(routes.settings())}
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={16} />
        </button>
        <button
          className={clsx(styles.newWorkspaceBtn)}
          onClick={onNewWorkspace ?? (() => navigate(routes.newWorkspace()))}
          aria-label="New workspace"
        >
          <Plus size={14} />
          New
        </button>
      </div>
    </aside>
  );

  if (mode === "overlay") {
    return (
      <>
        <div className={styles.sidebarOverlayBackdrop} onClick={onClose} aria-hidden />
        {sidebar}
      </>
    );
  }

  return sidebar;
}
