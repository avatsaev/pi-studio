/**
 * App router — route tree.
 *
 * Mounts the real `AppShell` (sprint-029 task-001), the real screen
 * components fed by live daemon data (task-002: Home/Sessions/Schedules/
 * Settings), the real Workspace screen assembly (task-003), and boot
 * gating + onboarding (task-004). See
 * clean-room-scope/sprints/sprint-029-final-app-shell/.
 *
 * `/welcome` and `/pair-scan` are top-level siblings of the `AppShell`
 * layout route — onboarding has no host yet, so it renders full-screen
 * without the persistent sidebar chrome (`AppShell` itself redirects to
 * `/welcome` when no daemon address is configured; see `AppShell.tsx`).
 */

import { createBrowserRouter, type RouteObject, Navigate } from "react-router";
import { AppShell } from "./AppShell.js";
import { DemoPage } from "./DemoPage.js";
import { LiveHomePage, LiveSessionsPage, LiveSchedulesPage, LiveSettingsPage } from "./LivePages.js";
import { LiveWorkspacePage } from "./LiveWorkspacePage.js";
import { LiveAgentPage } from "./LiveAgentPage.js";
import { NewAgentPage } from "./NewAgentPage.js";
import { OnboardingPage, PairScanPage } from "./OnboardingPage.js";

const routeTree: RouteObject[] = [
  { path: "/welcome", element: <OnboardingPage /> },
  { path: "/pair-scan", element: <PairScanPage /> },
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <LiveHomePage /> },
      { path: "open-project", element: <LiveHomePage /> },
      { path: "sessions", element: <LiveSessionsPage /> },
      { path: "schedules", element: <LiveSchedulesPage /> },
      { path: "new", element: <NewAgentPage /> },
      { path: "settings", element: <LiveSettingsPage /> },
      { path: "settings/:section", element: <LiveSettingsPage /> },
      { path: "h/:serverId", element: <LiveHomePage /> },
      { path: "h/:serverId/workspace/:workspaceId", element: <LiveWorkspacePage /> },
      { path: "h/:serverId/agent/:agentId", element: <LiveAgentPage /> },
      { path: "demo", element: <DemoPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routeTree);
}
