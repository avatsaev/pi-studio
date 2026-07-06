/**
 * LivePages — route-level pages that render the real, already-built screen
 * components (HomeScreen, SessionsScreen, SchedulesScreen, SettingsScreen),
 * fed by live daemon hooks via the pure adapters in `screen-adapters.ts`.
 *
 * Replaces the sprint-023/024 throwaway inline-styled placeholder pages.
 * clean-room-scope/features/app-navigation-screens.md
 */

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { HomeScreen } from "../components/screens/HomeScreen.js";
import { SessionsScreen } from "../components/screens/SessionsScreen.js";
import { SchedulesScreen } from "../components/screens/SchedulesScreen.js";
import { SettingsScreen } from "../components/screens/SettingsScreen.js";
import { useConnectionStatus } from "../providers/ConnectionProvider.js";
import { useAgentDirectory } from "../hooks/use-session-hooks.js";
import { useClient } from "../hooks/client-context.js";
import { useSchedulesQuery, useScheduleMutation, type Schedule } from "../hooks/use-nav-hooks.js";
import { ScheduleDetailDialog } from "../components/screens/ScheduleDetailDialog.js";
import { activeHostSnapshot, connectionToHostSnapshots } from "./shell-adapters.js";
import { toOpenProjectContext, toHostSessions, toHostSchedules, detectOsFamily } from "./screen-adapters.js";
import { routes, type WorkspaceOpenIntent } from "../runtime/route-grammar.js";
import type { OpenProjectTileId } from "../screens/open-project.js";

/** Tracks `window.innerWidth`, updating on resize (SSR-safe default). */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1024 : window.innerWidth));
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

// ─── Home ───────────────────────────────────────────────────────────────────

export function LiveHomePage() {
  const navigate = useNavigate();
  const connection = useConnectionStatus();
  const width = useViewportWidth();
  const host = activeHostSnapshot(connection);
  const context = toOpenProjectContext(host);

  function handleTilePress(tileId: OpenProjectTileId) {
    switch (tileId) {
      case "add-project":
        navigate(routes.newWorkspace());
        break;
      case "import-session":
        navigate(routes.sessions());
        break;
      case "setup-providers":
        navigate(routes.settingsSection("integrations"));
        break;
      case "pair-device":
        navigate(routes.pairScan("settings"));
        break;
    }
  }

  return <HomeScreen context={context} width={width} onTilePress={handleTilePress} />;
}

// ─── Sessions ───────────────────────────────────────────────────────────────

export function LiveSessionsPage() {
  const navigate = useNavigate();
  const connection = useConnectionStatus();
  const agents = useAgentDirectory();
  const host = activeHostSnapshot(connection);
  const hosts = toHostSessions(agents, host);

  return (
    <SessionsScreen
      hosts={hosts}
      onSelectSession={(row) => {
        const openIntent: WorkspaceOpenIntent = { kind: "agent", id: row.agentId };
        navigate(routes.agent(row.serverId, row.agentId));
        void openIntent; // reserved for workspace-open-intent wiring (task-003)
      }}
    />
  );
}

// ─── Schedules ──────────────────────────────────────────────────────────────

export function LiveSchedulesPage() {
  const navigate = useNavigate();
  const connection = useConnectionStatus();
  const client = useClient();
  const agents = useAgentDirectory();
  const host = activeHostSnapshot(connection);

  const schedulesQuery = useSchedulesQuery(host?.serverId, client);
  const schedules = schedulesQuery.data ?? [];
  const hosts = toHostSchedules(schedules, agents, host, schedulesQuery.isLoading);
  const mutation = useScheduleMutation(client);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = schedules.find((s) => s.id === selectedId) ?? null;
  const serverId = host?.serverId;

  return (
    <>
      <SchedulesScreen
        hosts={hosts}
        onNewSchedule={() => navigate(routes.newWorkspace())}
        onSelect={(row) => setSelectedId(row.scheduleId)}
      />
      <ScheduleDetailDialog
        schedule={selected}
        onClose={() => setSelectedId(null)}
        onPause={(s: Schedule) => serverId && mutation.toggle.mutate({ serverId, scheduleId: s.id, enabled: false })}
        onResume={(s: Schedule) => serverId && mutation.toggle.mutate({ serverId, scheduleId: s.id, enabled: true })}
        onRunNow={(s: Schedule) => serverId && mutation.runNow.mutate({ serverId, scheduleId: s.id })}
        onDelete={(s: Schedule) => {
          if (serverId) mutation.remove.mutate({ serverId, scheduleId: s.id });
          setSelectedId(null);
        }}
      />
    </>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────

export function LiveSettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const connection = useConnectionStatus();
  const width = useViewportWidth();
  const [activeTheme, setActiveTheme] = useState("dark");

  const hosts = connectionToHostSnapshots(connection);
  const os = detectOsFamily();

  return (
    <SettingsScreen
      path={location.pathname}
      width={width}
      isDesktop={false}
      isElectron={false}
      hosts={hosts}
      activeTheme={activeTheme}
      os={os}
      daemonMode="remote-only"
      onNavigate={(route) => navigate(route)}
      onThemeChange={(variant) => setActiveTheme(variant)}
    />
  );
}

// Workspace page assembly (TabStrip/PaneTree/WorkspaceHeader/PaneContentRouter)
// is sprint-029 task-003 — not built here.
