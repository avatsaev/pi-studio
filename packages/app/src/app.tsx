/**
 * App — Root React component.
 * Wraps with providers and the router.
 */

import { RouterProvider } from "react-router";
import { AppProviders } from "./providers/AppProviders.js";
import { createAppRouter } from "./router/routes.js";

const router = createAppRouter();

export function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
