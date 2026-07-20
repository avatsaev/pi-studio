import { AppProviders } from "./providers/AppProviders.js";
import { AppRouter } from "./routes/AppRouter.js";
import { useConnectionBoot } from "./hooks/use-connection.js";
import { useSessionRestore } from "./hooks/use-session-restore.js";
import { useShortcuts } from "./hooks/use-shortcuts.js";

function Boot() {
  useConnectionBoot();
  useSessionRestore();
  useShortcuts();
  return null;
}

// Root component. Connection boot + session restore + global shortcuts run once at the top,
// ABOVE the router — their once-guards are per component instance, so they must never
// remount on navigation. Route elements render under AppRouter.
export function App() {
  return (
    <AppProviders>
      <Boot />
      <AppRouter />
    </AppProviders>
  );
}
