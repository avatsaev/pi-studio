import { clsx } from "clsx";
import {
  type LucideIcon,
  AlertTriangle,
  Download,
  ExternalLink,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { Icon, Spinner } from "@av-pi-studio/ui-library";
import { getHost } from "../../host/install.js";
import { ExternalAnchor } from "../../host/external-link.js";
import { type AppUpdateCommand, runAppUpdateCommand } from "./app-update-actions.js";
import { type AppUpdateView } from "./app-update-presentation.js";
import styles from "./AppUpdateIndicator.module.css";

const ICON_SIZE = 12;

/** `progress` is a spinner (nothing to wait for by clicking); the rest say what a click does. */
export type UpdatePillIcon = "download" | "restart" | "check" | "open" | "alert" | "progress";

/** What the pill looks like: the app's and the daemon's presentations both produce it. */
export interface UpdatePillView {
  text: string;
  tooltip: string;
  tone: "attention" | "muted" | "danger";
}

/** What a click does: a button, a link to a page, or nothing. */
export type UpdatePillActivation =
  | { kind: "button"; onActivate: () => void }
  | { kind: "link"; url: string }
  | null;

const PILL_ICONS: Record<Exclude<UpdatePillIcon, "progress">, LucideIcon> = {
  download: Download,
  restart: RotateCw,
  check: RefreshCw,
  open: ExternalLink,
  alert: AlertTriangle,
};

const APP_ICONS: Record<AppUpdateCommand["kind"], UpdatePillIcon> = {
  install: "download",
  restart: "restart",
  check: "check",
};

function onCommand(command: AppUpdateCommand): void {
  const updates = getHost().updates;
  if (updates) void runAppUpdateCommand(updates, command);
}

/** The pill's content: an icon (a spinner for progress), then the text. */
function PillContent({ view, icon }: { view: UpdatePillView; icon: UpdatePillIcon }) {
  return (
    <>
      {icon === "progress" ? (
        <Spinner size={ICON_SIZE - 3} className={styles.icon} aria-label="Updating" />
      ) : (
        <Icon icon={PILL_ICONS[icon]} size={ICON_SIZE} className={styles.icon} aria-hidden />
      )}
      <span className={styles.text}>{view.text}</span>
    </>
  );
}

/** The update pill of the connection bar, shared by the app's and the daemon's update. */
export function UpdatePill({
  view,
  icon,
  activation,
}: {
  view: UpdatePillView;
  icon: UpdatePillIcon;
  activation: UpdatePillActivation;
}) {
  const className = clsx(styles.indicator, styles[view.tone]);
  if (activation === null) {
    return (
      <span className={className} title={view.tooltip}>
        <PillContent view={view} icon={icon} />
      </span>
    );
  }
  if (activation.kind === "link") {
    return (
      <ExternalAnchor
        href={activation.url}
        className={clsx(className, styles.actionable)}
        title={view.tooltip}
      >
        <PillContent view={view} icon={icon} />
      </ExternalAnchor>
    );
  }
  return (
    <button
      type="button"
      className={clsx(className, styles.actionable)}
      title={view.tooltip}
      onClick={activation.onActivate}
    >
      <PillContent view={view} icon={icon} />
    </button>
  );
}

/** The app's update pill beside the version: a button, a link to the release page, or progress. */
export function AppUpdateIndicator({ view }: { view: AppUpdateView }) {
  const { action } = view;
  if (action === null) return <UpdatePill view={view} icon="progress" activation={null} />;
  if (action.kind === "open") {
    return <UpdatePill view={view} icon="open" activation={{ kind: "link", url: action.url }} />;
  }
  return (
    <UpdatePill
      view={view}
      icon={APP_ICONS[action.kind]}
      activation={{ kind: "button", onActivate: () => onCommand(action) }}
    />
  );
}
