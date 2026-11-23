import { clsx } from "clsx";
import { type LucideIcon, Download, ExternalLink, RefreshCw, RotateCw } from "lucide-react";
import { Icon, Spinner } from "@av-pi-studio/ui-library";
import { getHost } from "../../host/install.js";
import { ExternalAnchor } from "../../host/external-link.js";
import { type AppUpdateCommand, runAppUpdateCommand } from "./app-update-actions.js";
import { type AppUpdateView } from "./app-update-presentation.js";
import styles from "./AppUpdateIndicator.module.css";

const ICON_SIZE = 12;

const COMMAND_ICONS: Record<AppUpdateCommand["kind"], LucideIcon> = {
  install: Download,
  restart: RotateCw,
  check: RefreshCw,
};

function onCommand(command: AppUpdateCommand): void {
  const updates = getHost().updates;
  if (updates) void runAppUpdateCommand(updates, command);
}

/** The pill's content: an icon for what a click does (a spinner while there is nothing to click), then the text. */
function PillContent({ view }: { view: AppUpdateView }) {
  const { action } = view;
  return (
    <>
      {action === null ? (
        <Spinner size={ICON_SIZE - 3} className={styles.icon} aria-label="Updating" />
      ) : (
        <Icon
          icon={action.kind === "open" ? ExternalLink : COMMAND_ICONS[action.kind]}
          size={ICON_SIZE}
          className={styles.icon}
          aria-hidden
        />
      )}
      <span className={styles.text}>{view.text}</span>
    </>
  );
}

/** The update pill beside the version: a button, a link to the release page, or progress. */
export function AppUpdateIndicator({ view }: { view: AppUpdateView }) {
  const className = clsx(styles.indicator, styles[view.tone]);
  const { action } = view;
  if (action === null) {
    return (
      <span className={className} title={view.tooltip}>
        <PillContent view={view} />
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
        <PillContent view={view} />
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
      <PillContent view={view} />
    </button>
  );
}
