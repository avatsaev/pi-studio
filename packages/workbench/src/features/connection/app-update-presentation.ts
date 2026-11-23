/**
 * The connection bar's update indicator as pure data (`swe/features/desktop-self-update.md` U14):
 * what the one short text says, what its tooltip explains, and what a click does. Idle, checking
 * and up to date show nothing. `ConnectionBar.tsx` only binds it to the host and the DOM.
 */

import type {
  AppUpdateFailureCode,
  AppUpdateState,
  AppUpdateUnavailableReason,
} from "../../host/types.js";

/** What a click on the indicator runs. `open` is the release page, through `links.openExternal`. */
export type AppUpdateAction =
  | { kind: "install" }
  | { kind: "restart" }
  | { kind: "check" }
  | { kind: "open"; url: string };

export interface AppUpdateView {
  /** The short text beside the version. */
  text: string;
  /** The native tooltip: the reason or the explanation of the text. */
  tooltip: string;
  /** `attention`: an offer or a restart (orange); `muted`: progress or a build the app cannot install; `danger`: a failure. */
  tone: "attention" | "muted" | "danger";
  /** `null`: progress only, nothing to click. */
  action: AppUpdateAction | null;
}

const UNAVAILABLE_REASONS: Record<AppUpdateUnavailableReason, string> = {
  development_build: "This is a development build; it cannot update itself.",
  not_writable: "The app's file or its folder is not writable, so it cannot update itself.",
  read_only_location: "The app runs from a read-only location, so it cannot update itself.",
  no_pkexec: "Installing a system package needs pkexec, which is not installed.",
};

const FAILURE_TEXTS: Record<AppUpdateFailureCode, string> = {
  offline: "Could not reach the update server",
  manifest_invalid: "The update information is not valid",
  no_target: "No update for this kind of install",
  signature: "The update's signature does not match",
  download: "The download failed",
  install: "The update could not be installed",
  refused: "The system did not allow the install",
};

/** Whole percent of a download, `null` while the total is unknown. */
function downloadPercent(received: number, total: number | undefined): number | null {
  if (total === undefined || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.floor((received / total) * 100)));
}

export function appUpdateView(update: AppUpdateState): AppUpdateView | null {
  switch (update.state) {
    case "idle":
    case "checking":
    case "up_to_date":
      return null;
    case "available":
      return {
        text: `Update ${update.version}`,
        tooltip: `Download and install Pi Studio ${update.version}`,
        tone: "attention",
        action: { kind: "install" },
      };
    case "downloading": {
      const percent = downloadPercent(update.received, update.total);
      return {
        text: percent === null ? "Updating…" : `Updating ${percent}%`,
        tooltip: `Downloading Pi Studio ${update.version}`,
        tone: "muted",
        action: null,
      };
    }
    case "restart_needed":
      return {
        text: "Restart to update",
        tooltip: `Restart to finish updating to Pi Studio ${update.version}`,
        tone: "attention",
        action: { kind: "restart" },
      };
    case "cannot_install":
      return {
        text: `${update.version} available`,
        tooltip: `${UNAVAILABLE_REASONS[update.reason]} Open the release page.`,
        tone: "muted",
        action: { kind: "open", url: update.releaseUrl },
      };
    case "failed": {
      // The system refused the install: another try would be refused too, so the click opens the
      // download page. Any other failure of an install retries it; a failed check has no build to
      // install, so it checks again.
      if (update.code === "refused" && update.releaseUrl !== undefined) {
        return {
          text: "Update failed",
          tooltip: `${FAILURE_TEXTS[update.code]}. Open the release page.`,
          tone: "danger",
          action: { kind: "open", url: update.releaseUrl },
        };
      }
      return {
        text: "Update failed",
        tooltip: `${FAILURE_TEXTS[update.code]}. Click to try again.`,
        tone: "danger",
        action: update.version === undefined ? { kind: "check" } : { kind: "install" },
      };
    }
  }
}
