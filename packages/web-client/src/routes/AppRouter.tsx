/**
 * AppRouter — the client-side route table.
 *
 * The web build uses history-API routing (docker nginx serves the SPA fallback). The
 * Electron renderer loads from `file://`, where history routing cannot work, so that
 * build switches to hash routing. The router lives at module scope to keep its identity
 * stable across renders.
 *
 * Connection deep links remain query-string based. `useConnectionBoot`, mounted above
 * this router, continues to read them from `window.location.search`.
 */

import { createBrowserRouter, createHashRouter, Navigate, RouterProvider } from "react-router";
import { WorkspacePage } from "./WorkspacePage.js";

const routes = [
  { path: "/", Component: WorkspacePage },
  { path: "*", element: <Navigate to="/" replace /> },
];

const router =
  import.meta.env.VITE_TARGET === "electron"
    ? createHashRouter(routes)
    : createBrowserRouter(routes);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
