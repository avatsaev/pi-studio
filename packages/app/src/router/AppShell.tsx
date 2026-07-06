/**
 * AppShell — the real root layout: persistent LeftSidebar + CommandCenter +
 * ShortcutDispatcher/ShortcutsDialog + Toast host, wrapping the routed outlet.
 *
 * Theme is applied at the `AppProviders` level via `ThemeBoundary` (one level
 * above this component) — all colors/spacing here come from the `--pi-*` CSS
 * variables it sets on `:root`, never inline hex values.
 *
 * clean-room-scope/features/app-navigation-screens.md § Left sidebar, § Command center
 * clean-room-scope/architecture/client-app-runtime.md § App shell
 */

import { useState } from "react";
import { Outlet, useNavigate, Navigate } from "react-router";
import { ToastHost } from "../components/overlays/Toast.js";
import { ToastProvider } from "../components/overlays/ToastContext.js";
import { LeftSidebar } from "../components/nav/LeftSidebar.js";
import { CommandCenter } from "../components/nav/CommandCenter.js";
import { ShortcutDispatcher } from "../components/nav/ShortcutDispatcher.js";
import { ShortcutsDialog } from "../components/nav/ShortcutsDialog.js";
import { useConnectionStatus } from "../providers/ConnectionProvider.js";
import { useAgentDirectory } from "../hooks/use-session-hooks.js";
import { Spinner } from "../components/primitives/Spinner.js";
import { routes } from "../runtime/route-grammar.js";
import { activeHostSnapshot, connectionToHostSnapshots, toCommandCenterAgents } from "./shell-adapters.js";
import { BootGate } from "./BootGate.js";
import { createWebKVStore } from "../providers/kv-store.js";
import styles from "./AppShell.module.css";

// Reused across renders — a stateless wrapper around localStorage.
const kvStore = createWebKVStore();

export function AppShell() {
  const navigate = useNavigate();
  const connection = useConnectionStatus();
  const agents = useAgentDirectory();

  const [commandCenterOpen, setCommandCenterOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // No daemon address configured at all — send the user to onboarding
  // instead of showing an inline spinner forever.
  if (connection.status === "no-hosts") {
    return <Navigate to={routes.welcome()} replace />;
  }

  // A daemon address IS configured but we haven't connected yet — show the
  // connecting splash. `BootGate` below handles the "give up after timeout
  // → onboarding" case once at least one host is known/online.
  if (connection.status === "connecting") {
    return (
      <div className={styles.splash}>
        <Spinner size="lg" />
        <p className={styles.splashLabel}>Connecting to daemon…</p>
      </div>
    );
  }

  const hosts = connectionToHostSnapshots(connection);
  const activeHost = activeHostSnapshot(connection);
  const commandCenterAgents = toCommandCenterAgents(agents, connection.serverId);

  // Sidebar workspace rows from the live agent directory (dev: workspaceId === agentId).
  const workspaceRows = agents.map((a) => ({
    workspaceId: a.workspaceId ?? a.agentId,
    label: a.title ?? a.cwd ?? a.agentId,
    projectKey: a.cwd,
    lastActivityMs: a.lastActivity,
  }));

  function handleShortcutAction(actionId: string) {
    switch (actionId) {
      case "toggle-command-center":
        setCommandCenterOpen((v) => !v);
        break;
      case "show-shortcuts":
        setShortcutsOpen((v) => !v);
        break;
      case "new-agent":
        navigate(routes.newWorkspace());
        break;
      case "toggle-settings":
        navigate(routes.settings());
        break;
      default:
        break;
    }
  }

  return (
    <ToastProvider>
      <div className={styles.shell}>
        <LeftSidebar
          hosts={hosts}
          activeHost={activeHost}
          workspaces={workspaceRows}
          mode="pinned"
          onNewWorkspace={() => navigate(routes.newWorkspace())}
          onOpenCommandCenter={() => setCommandCenterOpen(true)}
        />

        <main className={styles.main}>
          <div className={styles.content}>
            <BootGate hosts={hosts} kvStore={kvStore}>
              <Outlet />
            </BootGate>
          </div>
        </main>

        <div id="pi-portal-root" className={styles.portalRoot} />
        <ToastHost />

        <CommandCenter
          open={commandCenterOpen}
          onClose={() => setCommandCenterOpen(false)}
          agents={commandCenterAgents}
        />
        <ShortcutsDialog visible={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <ShortcutDispatcher onAction={handleShortcutAction} commandCenterOpen={commandCenterOpen} />
      </div>
    </ToastProvider>
  );
}
