import { clsx } from "clsx";
import { getHost } from "../../host/install.js";
import { ExternalAnchor } from "../../host/external-link.js";
import { type AppUpdateCommand, runAppUpdateCommand } from "./app-update-actions.js";
import { type AppUpdateView } from "./app-update-presentation.js";
import styles from "./AppUpdateIndicator.module.css";

function onCommand(command: AppUpdateCommand): void {
  const updates = getHost().updates;
  if (updates) void runAppUpdateCommand(updates, command);
}

/** The short update text beside the version: a button, a link to the release page, or progress. */
export function AppUpdateIndicator({ view }: { view: AppUpdateView }) {
  const className = clsx(styles.indicator, styles[view.tone]);
  const { action } = view;
  if (action === null) {
    return (
      <span className={className} title={view.tooltip}>
        {view.text}
      </span>
    );
  }
  if (action.kind === "open") {
    return (
      <ExternalAnchor
        href={action.url}
        className={clsx(className, styles.actionable)}
        title={view.tooltip}
      >
        {view.text}
      </ExternalAnchor>
    );
  }
  return (
    <button
      type="button"
      className={clsx(className, styles.actionable)}
      title={view.tooltip}
      onClick={() => onCommand(action)}
    >
      {view.text}
    </button>
  );
}
