import { useEffect, useState } from "react";
import { useDaemonUpdateBoot } from "../features/connection/use-daemon-update.js";
import { useDaemonsStore } from "../features/daemons/daemons-store.js";
import { getHost } from "../host/install.js";
import { useAgentDeepLinkBoot } from "../hooks/use-agent-deep-link-boot.js";
import { useAgentTodosBoot } from "../hooks/use-agent-todos.js";
import { useConnectionBoot } from "../hooks/use-connection.js";
import { usePaneLayoutBoot } from "../hooks/use-pane-layout.js";
import { useSessionRestore } from "../hooks/use-session-restore.js";
import { useSessionResync } from "../hooks/use-session-resync.js";
import { useShortcuts } from "../hooks/use-shortcuts.js";
import { useTerminalExitWatch } from "../hooks/use-terminal-exit-watch.js";
import { useTerminalRestore } from "../hooks/use-terminal-restore.js";
import { useTimelineResetWatch } from "../hooks/use-timeline-reset-watch.js";
import { useViewerSettingsBoot } from "../hooks/use-viewer-settings.js";
import { createResumeHandler } from "../lib/connection/resume-handler.js";
import { useRequireWorkbench, warnOnce } from "./context.js";

/**
 * Checks a possibly stale connection whenever the host signals a resume (sprint-050). A connect
 * that never opened is connected again as the connection bar's Retry does.
 */
function useResumeSignal(): void {
  useEffect(
    () =>
      getHost().connection.onResume(
        createResumeHandler(() => void useDaemonsStore.getState().connectCurrent()),
      ),
    [],
  );
}

/** The boot sequence. The hook order is load-bearing. */
function BootSequence() {
  useConnectionBoot();
  useAgentDeepLinkBoot();
  useViewerSettingsBoot();
  useDaemonUpdateBoot();
  useAgentTodosBoot();
  // Before the restore hooks: an arriving tab consumes its pane claim, so the claims must exist.
  usePaneLayoutBoot();
  useSessionRestore();
  useSessionResync();
  useTerminalRestore();
  useTerminalExitWatch();
  useTimelineResetWatch();
  useShortcuts();
  useResumeSignal();
  return null;
}

/** Which mounted `WorkbenchBoot` runs the sequence. Released on unmount, so StrictMode's
 *  mount → unmount → mount re-claims it. */
let bootOwner: symbol | null = null;

/** Runs the application's boot sequence. Renders nothing; mount exactly once inside
 *  `WorkbenchProvider`. A second instance does nothing and warns once in development. */
export function WorkbenchBoot() {
  useRequireWorkbench("WorkbenchBoot");
  const [active, setActive] = useState(false);

  useEffect(() => {
    const token = Symbol("WorkbenchBoot");
    if (bootOwner !== null) {
      warnOnce("boot", "A second <WorkbenchBoot> is mounted; it does nothing. Mount exactly one.");
      return;
    }
    bootOwner = token;
    setActive(true);
    return () => {
      if (bootOwner === token) bootOwner = null;
      setActive(false);
    };
  }, []);

  return active ? <BootSequence /> : null;
}
