import { AppProviders } from "./providers/AppProviders.js";
import { WorkspacePage } from "./routes/WorkspacePage.js";
import { useConnectionBoot } from "./hooks/use-connection.js";
import { usePaneLayoutBoot } from "./hooks/use-pane-layout.js";
import { useSessionRestore } from "./hooks/use-session-restore.js";
import { useTerminalRestore } from "./hooks/use-terminal-restore.js";
import { useTerminalExitWatch } from "./hooks/use-terminal-exit-watch.js";
import { useShortcuts } from "./hooks/use-shortcuts.js";

function Boot() {
  useConnectionBoot();
  // Before the restore hooks: an arriving tab consumes its pane claim, so the claims must exist.
  usePaneLayoutBoot();
  useSessionRestore();
  useTerminalRestore();
  useTerminalExitWatch();
  useShortcuts();
  return null;
}

// Root component. Connection boot + pane-layout install + session restore + global shortcuts run
// once at the top; the workspace shell renders the 3-column layout.
export function App() {
  return (
    <AppProviders>
      <Boot />
      <WorkspacePage />
    </AppProviders>
  );
}
