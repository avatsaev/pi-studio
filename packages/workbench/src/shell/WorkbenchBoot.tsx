import { useAgentDeepLinkBoot } from "../hooks/use-agent-deep-link-boot.js";
import { useAgentTodosBoot } from "../hooks/use-agent-todos.js";
import { useConnectionBoot } from "../hooks/use-connection.js";
import { usePaneLayoutBoot } from "../hooks/use-pane-layout.js";
import { useSessionRestore } from "../hooks/use-session-restore.js";
import { useShortcuts } from "../hooks/use-shortcuts.js";
import { useTerminalExitWatch } from "../hooks/use-terminal-exit-watch.js";
import { useTerminalRestore } from "../hooks/use-terminal-restore.js";
import { useTimelineResetWatch } from "../hooks/use-timeline-reset-watch.js";
import { useViewerSettingsBoot } from "../hooks/use-viewer-settings.js";

/** Runs the application's boot sequence once. Renders nothing; mount exactly once inside
 *  `WorkbenchProvider`. The hook order is load-bearing. */
export function WorkbenchBoot() {
  useConnectionBoot();
  useAgentDeepLinkBoot();
  useViewerSettingsBoot();
  useAgentTodosBoot();
  // Before the restore hooks: an arriving tab consumes its pane claim, so the claims must exist.
  usePaneLayoutBoot();
  useSessionRestore();
  useTerminalRestore();
  useTerminalExitWatch();
  useTimelineResetWatch();
  useShortcuts();
  return null;
}
