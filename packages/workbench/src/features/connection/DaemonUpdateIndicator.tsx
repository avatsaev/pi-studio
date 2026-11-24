import { useUiStore } from "../../stores/ui-store.js";
import { UpdatePill } from "./AppUpdateIndicator.js";
import { useDaemonUpdateStore } from "./daemon-update-store.js";
import { daemonUpdateView } from "./daemon-update-presentation.js";

/**
 * The daemon's update pill, left of the app's own. Drawn from the broadcast status, which is
 * `null` without the `daemonUpdate` capability; every state it shows opens the update dialog.
 */
export function DaemonUpdateIndicator() {
  const status = useDaemonUpdateStore((s) => s.status);
  const openDialog = useUiStore((s) => s.openDaemonUpdateDialog);
  const view = status && daemonUpdateView(status);
  if (!view) return null;
  return (
    <UpdatePill
      view={view}
      icon={view.icon}
      activation={{ kind: "button", onActivate: openDialog }}
    />
  );
}
