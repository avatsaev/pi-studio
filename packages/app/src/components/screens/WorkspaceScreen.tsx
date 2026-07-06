/**
 * WorkspaceScreen — /h/:serverId/workspace/:workspaceId.
 * Resolves the route-gate state machine; renders gate UI or the ready shell frame.
 * workspace-ui.md § Route gating, § Screen composition
 */

import { useMemo, type ReactNode } from "react";
import styles from "./WorkspaceScreen.module.css";
import { Button, Spinner } from "../primitives/index.js";
import {
  resolveWorkspaceRouteGate,
  type WorkspaceRouteGateInput,
  type WorkspaceGateState,
} from "../../workspace/route-gating.js";
import {
  composeWorkspaceScreen,
  type WorkspaceComposition,
  type WorkspaceFormFactor,
} from "../../workspace/composition.js";
import type { SplitPane } from "../../workspace/layout.js";

// ---------------------------------------------------------------------------
// Gate UI
// ---------------------------------------------------------------------------

function GateView({ gate, onAction }: { gate: WorkspaceGateState; onAction: (action: string) => void }) {
  switch (gate.state) {
    case "splash":
      return (
        <div className={styles.gate}>
          <Spinner />
        </div>
      );
    case "loading":
      return (
        <div className={styles.gate}>
          <Spinner />
          <p className={styles.gateMessage}>Loading workspace…</p>
        </div>
      );
    case "reconnecting":
      return (
        <div className={styles.gate}>
          <Spinner />
          <h2 className={styles.gateTitle}>Reconnecting</h2>
          <p className={styles.gateMessage}>Trying to reconnect to the host…</p>
          <div className={styles.gateActions}>
            <Button size="sm" onClick={() => onAction("retry-host")}>Retry</Button>
            <Button size="sm" variant="ghost" onClick={() => onAction("manage-host")}>Manage host</Button>
          </div>
        </div>
      );
    case "unreachable":
      return (
        <div className={styles.gate}>
          <h2 className={styles.gateTitle}>Host Unreachable</h2>
          <p className={styles.gateMessage}>Cannot connect to the host. Check that the daemon is running.</p>
          <div className={styles.gateActions}>
            <Button size="sm" onClick={() => onAction("retry-host")}>Retry</Button>
            <Button size="sm" variant="ghost" onClick={() => onAction("manage-host")}>Manage host</Button>
          </div>
        </div>
      );
    case "missing":
      return (
        <div className={styles.gate}>
          <h2 className={styles.gateTitle}>Workspace Not Found</h2>
          <p className={styles.gateMessage}>This workspace no longer exists on the host.</p>
          <div className={styles.gateActions}>
            <Button size="sm" onClick={() => onAction("dismiss-missing-workspace")}>Dismiss</Button>
            <Button size="sm" variant="ghost" onClick={() => onAction("manage-host")}>Manage host</Button>
          </div>
        </div>
      );
    case "foreign":
      return (
        <div className={styles.gate}>
          <h2 className={styles.gateTitle}>Wrong Host</h2>
          <p className={styles.gateMessage}>This workspace belongs to a different host.</p>
          <div className={styles.gateActions}>
            <Button size="sm" onClick={() => onAction(`redirect:${gate.redirect}`)}>Go to host</Button>
          </div>
        </div>
      );
    case "directory-missing":
      return (
        <div className={styles.gate}>
          <h2 className={styles.gateTitle}>Directory Missing</h2>
          <p className={styles.gateMessage}>The workspace directory no longer exists on disk.</p>
        </div>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Shell Frame (ready state)
// ---------------------------------------------------------------------------

export interface WorkspaceShellProps {
  composition: WorkspaceComposition;
  headerSlot?: ReactNode;
  tabStripSlot?: ReactNode;
  explorerSlot?: ReactNode;
  paneAreaSlot?: ReactNode;
}

function WorkspaceShell({ composition, headerSlot, tabStripSlot, explorerSlot, paneAreaSlot }: WorkspaceShellProps) {
  return (
    <div className={styles.shell}>
      {composition.showPrimaryHeader && <div className={styles.headerSlot}>{headerSlot}</div>}
      <div className={styles.tabStripSlot}>{tabStripSlot}</div>
      <div className={styles.bodyRow}>
        {composition.showExplorerSidebar && <div className={styles.explorerSlot}>{explorerSlot}</div>}
        <div className={styles.paneArea}>{paneAreaSlot}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Screen Component
// ---------------------------------------------------------------------------

export interface WorkspaceScreenProps {
  gateInput: WorkspaceRouteGateInput;
  formFactor: WorkspaceFormFactor;
  platform: "web" | "desktop" | "ios" | "android";
  focusMode?: boolean;
  explorerOpen?: boolean;
  workspaceDirPresent?: boolean;
  panes?: readonly SplitPane[];
  onGateAction: (action: string) => void;
  /** Slots filled by later tasks/sprints */
  headerSlot?: ReactNode;
  tabStripSlot?: ReactNode;
  explorerSlot?: ReactNode;
  paneAreaSlot?: ReactNode;
}

export function WorkspaceScreen({
  gateInput,
  formFactor,
  platform,
  focusMode = false,
  explorerOpen = false,
  workspaceDirPresent = true,
  panes = [],
  onGateAction,
  headerSlot,
  tabStripSlot,
  explorerSlot,
  paneAreaSlot,
}: WorkspaceScreenProps) {
  const gate = useMemo(() => resolveWorkspaceRouteGate(gateInput), [gateInput]);

  const composition = useMemo(
    () => composeWorkspaceScreen({ focusMode, formFactor, platform, explorerOpen, workspaceDirPresent, panes }),
    [focusMode, formFactor, platform, explorerOpen, workspaceDirPresent, panes],
  );

  if (gate.state !== "ready") {
    return (
      <div className={styles.container}>
        <GateView gate={gate} onAction={onGateAction} />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <WorkspaceShell
        composition={composition}
        headerSlot={headerSlot}
        tabStripSlot={tabStripSlot}
        explorerSlot={explorerSlot}
        paneAreaSlot={paneAreaSlot}
      />
    </div>
  );
}
