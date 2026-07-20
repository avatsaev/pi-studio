/**
 * AppRouter — the client-side route table: connect screen, workspace shell, settings.
 *
 * The web build uses history-API routing (docker nginx serves the SPA fallback); the
 * Electron renderer loads from `file://`, where history routing cannot work, so that build
 * switches to hash routing (vite.config.ts `VITE_TARGET`). The router is created once at
 * module scope so its identity is stable across renders.
 *
 * Deep links keep working unchanged: `?host=&password=&cwd=&connect=1` ride on
 * `window.location.search`, which routing does not touch — `useConnectionBoot` (mounted
 * above this router in `Boot`) reads them exactly as before.
 */

import { createBrowserRouter, createHashRouter, Navigate, RouterProvider } from "react-router";
import { ConnectPage } from "./ConnectPage.js";
import { SettingsPage } from "./SettingsPage.js";
import { WorkspacePage } from "./WorkspacePage.js";

const routes = [
  { path: "/", Component: WorkspacePage },
  { path: "/connect", Component: ConnectPage },
  { path: "/settings", Component: SettingsPage },
  { path: "*", element: <Navigate to="/" replace /> },
];

const router =
  import.meta.env.VITE_TARGET === "electron"
    ? createHashRouter(routes)
    : createBrowserRouter(routes);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
