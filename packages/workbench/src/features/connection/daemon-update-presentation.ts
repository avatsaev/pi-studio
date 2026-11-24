/**
 * The connection bar's daemon update pill as pure data (`swe/features/self-update.md` § Workbench,
 * P11): what the short text says, the tooltip, the tone and the icon. Every pill opens the update
 * dialog, so there is no per-state action. Nothing is drawn for `idle`, `checking` and a
 * `cannot_update` without a newer version. Separate from `app-update-presentation.ts`: the two
 * updates share only the pill component.
 */

import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";

export interface DaemonUpdateView {
  /** The short text on the pill. */
  text: string;
  /** The native tooltip: the explanation of the text. */
  tooltip: string;
  /** `attention`: an update to install (orange); `muted`: progress or an install that cannot update itself; `danger`: a failure. */
  tone: "attention" | "muted" | "danger";
  /** `progress`: the work is running (a spinner); the pill still opens the dialog. */
  icon: "download" | "progress" | "alert";
}

const UNAVAILABLE_REASONS: Record<string, string> = {
  docker: "This daemon runs in Docker; update its image instead.",
  source: "This daemon runs from a repository checkout; update the checkout instead.",
  unknown_install: "This daemon was not installed with npm install -g, so it cannot update itself.",
  npm_missing: "npm was not found on the daemon's host, so it cannot update itself.",
  not_writable: "npm's global folder is not writable by the daemon, so it cannot update itself.",
  unsupported_platform: "Updating a daemon on this platform is not supported.",
  unmanaged_binary:
    "This daemon binary was not installed by Pi Studio, so it cannot update itself. Download the new release.",
};

const FAILURE_TEXTS: Record<string, string> = {
  install: "The install failed",
  timeout: "The install took too long",
  permission: "The install was not permitted",
  network: "The install could not reach the registry",
};

/** The reason in words; a reason a newer daemon adds falls back to its raw code. */
export function unavailableReasonText(reason: string): string {
  return UNAVAILABLE_REASONS[reason] ?? `This daemon cannot update itself (${reason}).`;
}

/** The failure code in words; an unknown code falls back to a generic line. */
export function failureCodeText(code: string): string {
  return FAILURE_TEXTS[code] ?? "The update failed";
}

export function daemonUpdateView(status: DaemonUpdateStatus): DaemonUpdateView | null {
  const { state } = status;
  switch (state.kind) {
    case "idle":
    case "checking":
      return null;
    case "available":
      return {
        text: `Daemon ${state.version}`,
        tooltip: `Update the daemon from ${status.currentVersion} to ${state.version}`,
        tone: "attention",
        icon: "download",
      };
    case "installing":
      return {
        text: "Daemon updating",
        tooltip: `Installing daemon ${state.version}`,
        tone: "muted",
        icon: "progress",
      };
    case "updating_extensions":
      return {
        text: "Daemon updating",
        tooltip: `Updating the Pi extensions for daemon ${state.version}`,
        tone: "muted",
        icon: "progress",
      };
    case "restarting":
      return {
        text: "Daemon updating",
        tooltip: `Restarting the daemon on ${state.version}`,
        tone: "muted",
        icon: "progress",
      };
    case "failed":
      return {
        text: "Daemon update failed",
        tooltip: `${failureCodeText(state.code)}; the daemon stays on ${status.currentVersion}. Click for details.`,
        tone: "danger",
        icon: "alert",
      };
    case "cannot_update":
      if (state.version === undefined) return null;
      return {
        text: `Daemon ${state.version} available`,
        tooltip: `${unavailableReasonText(state.reason)} Click to see how to update it.`,
        tone: "muted",
        icon: "download",
      };
  }
}
