import { AppProviders } from "./providers/AppProviders.js";
import { WorkspacePage } from "./routes/WorkspacePage.js";
import { useConnectionBoot } from "./hooks/use-connection.js";
import { useSessionRestore } from "./hooks/use-session-restore.js";
import { useTerminalRestore } from "./hooks/use-terminal-restore.js";
import { useShortcuts } from "./hooks/use-shortcuts.js";

function Boot() {
  useConnectionBoot();
  useSessionRestore();
  useTerminalRestore();
  useShortcuts();
  return null;
}

// Root component. Connection boot + session restore + global shortcuts run once at the top;
// the workspace shell renders the 3-column layout.
export function App() {
  return (
    <AppProviders>
      <Boot />
      <WorkspacePage />
    </AppProviders>
  );
}
