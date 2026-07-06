/**
 * Demo screen wrappers — provide mock data to each screen for visual testing.
 * Uses `as any` for mock data since this is purely for development/preview.
 */

import { WelcomeScreen } from "../components/screens/WelcomeScreen.js";
import { SessionsScreen } from "../components/screens/SessionsScreen.js";
import { SchedulesScreen } from "../components/screens/SchedulesScreen.js";
import { SettingsScreen } from "../components/screens/SettingsScreen.js";
import { NewWorkspaceScreen } from "../components/screens/NewWorkspaceScreen.js";
import { OpenProjectScreen } from "../components/screens/OpenProjectScreen.js";

export function DemoWelcome() {
  return (
    <WelcomeScreen
      platform="web"
      hosts={[]}
      onAddHost={() => console.log("add host")}
      onPasteLink={() => console.log("paste link")}
    />
  );
}

export function DemoSessions() {
  return (
    <SessionsScreen
      hosts={[
        {
          serverId: "local",
          hostLabel: "Local Machine",
          loading: false,
          rows: [
            { agentId: "agent-1", title: "Pi-Studio dev", status: "running", cwd: "/home/user/project", startedAtMs: Date.now() - 3600000, lastActivityMs: Date.now() - 60000, provider: "pi" },
            { agentId: "agent-2", title: "API refactor", status: "idle", cwd: "/home/user/api", startedAtMs: Date.now() - 86400000, lastActivityMs: Date.now() - 7200000, provider: "pi" },
            { agentId: "agent-3", title: "Bug fix #412", status: "error", cwd: "/home/user/bugfix", startedAtMs: Date.now() - 172800000, lastActivityMs: Date.now() - 86400000, provider: "pi" },
          ],
        },
      ] as any}
      onSelectSession={(row) => console.log("select session", row)}
    />
  );
}

export function DemoSchedules() {
  return (
    <SchedulesScreen
      hosts={[
        {
          serverId: "local",
          hostLabel: "Local Machine",
          loading: false,
          agentDirectoryReady: true,
          agents: [{ agentId: "agent-1", title: "Dev Agent" }],
          schedules: [
            { id: "sched-1", name: "Nightly tests", prompt: "Run all tests", cadence: { type: "cron", expression: "0 2 * * *" }, target: { type: "agent", agentId: "agent-1" }, status: "active", createdAt: new Date().toISOString(), runs: [] },
            { id: "sched-2", name: "Weekly report", prompt: "Generate report", cadence: { type: "cron", expression: "0 9 * * 1" }, target: { type: "new-agent", config: { provider: "pi" } }, status: "paused", createdAt: new Date().toISOString(), runs: [] },
          ],
        },
      ] as any}
      onNewSchedule={() => console.log("new schedule")}
      onSelect={(row) => console.log("select", row)}
    />
  );
}

export function DemoSettings() {
  return (
    <SettingsScreen
      path="/settings"
      width={900}
      isDesktop={false}
      isElectron={false}
      hosts={[]}
      activeTheme="dark"
      os="linux"
      onNavigate={(p) => console.log("nav", p)}
      onThemeChange={(t) => console.log("theme", t)}
    />
  );
}

export function DemoNewWorkspace() {
  return (
    <NewWorkspaceScreen
      client={{ launch: async () => ({ agentId: "new-1", workspaceId: "ws-1" }) } as any}
      projects={[
        { id: "proj-1", name: "pi-studio", path: "/home/user/pi-studio" },
        { id: "proj-2", name: "my-app", path: "/home/user/my-app" },
      ] as any}
      refs={[
        { ref: "main", label: "main" },
        { ref: "develop", label: "develop" },
      ] as any}
      providers={[
        { value: "pi", label: "Pi (default)" },
        { value: "mock", label: "Mock provider" },
      ]}
    />
  );
}

export function DemoOpenProject() {
  return (
    <OpenProjectScreen
      recentProjects={[
        { projectId: "p1", name: "pi-studio", path: "/home/user/DEV/pi-studio", lastOpenedAt: Date.now() - 3600000 },
        { projectId: "p2", name: "my-website", path: "/home/user/DEV/my-website", lastOpenedAt: Date.now() - 86400000 },
        { projectId: "p3", name: "api-server", path: "/home/user/DEV/api-server", lastOpenedAt: Date.now() - 172800000 },
      ] as any}
      onSelect={(opts) => console.log("open project", opts)}
      onBrowse={() => console.log("browse")}
    />
  );
}

export function DemoWorkspace() {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 8px" }}>Workspace View</h2>
      <p style={{ color: "var(--pi-color-foregroundMuted)", fontSize: 13 }}>
        The workspace screen requires a live daemon connection to render timeline, tabs, and panels.
        See the home page demo for individual component previews.
      </p>
    </div>
  );
}
