/**
 * What Settings → Daemon shows, as pure data (`swe/features/self-update.md` § Workbench): the
 * version, the install kind, the last check, the update row and the state of the two controls. The
 * panel only draws it and wires the buttons.
 *
 * The update row is the same offer as the pill's, in a sentence; its action opens the update
 * dialog. A daemon that cannot update itself says why only when there is something to install
 * (the install kind is shown at all times, in its own row).
 */

import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";
import {
  failureCodeText,
  unavailableReasonText,
} from "../connection/daemon-update-presentation.js";
import { checkErrorText } from "../daemon-update/daemon-update-actions.js";

export interface DaemonSettingsInput {
  status: DaemonUpdateStatus;
  /** The automatic-check switch's optimistic value while its request is out, else `null`. */
  pendingAutoCheck: boolean | null;
  /** Epoch ms of "now"; a parameter so the wording of the last check is testable. */
  now: number;
}

export interface DaemonSettingsView {
  version: string;
  installKind: string;
  /** "Never", "Just now", "5 minutes ago"… */
  lastChecked: string;
  /** The last check's failure in words; absent when it did not fail. */
  checkError?: string;
  /** The switch's value: the optimistic one while a request is out. */
  autoCheck: boolean;
  /** The update is running or being asked about: "Check now" has nothing to add. */
  checkDisabled: boolean;
  update: {
    text: string;
    tone: "success" | "attention" | "muted" | "danger";
    /** The button's label; absent when there is nothing to open. */
    action?: string;
  };
}

const INSTALL_KINDS: Record<string, string> = {
  "npm-global": "npm (global install)",
  docker: "Docker",
  source: "Repository checkout",
  unknown: "Unknown",
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "1 minute", "5 minutes" */
function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** The time since a check, coarse: the daemon checks every six hours, so seconds say nothing. */
export function lastCheckedText(checkedAt: number | undefined, now: number): string {
  if (checkedAt === undefined) return "Never";
  const elapsed = Math.max(0, now - checkedAt);
  if (elapsed < MINUTE_MS) return "Just now";
  if (elapsed < HOUR_MS) return `${plural(Math.floor(elapsed / MINUTE_MS), "minute")} ago`;
  if (elapsed < DAY_MS) return `${plural(Math.floor(elapsed / HOUR_MS), "hour")} ago`;
  return `${plural(Math.floor(elapsed / DAY_MS), "day")} ago`;
}

export function installKindText(kind: string): string {
  return INSTALL_KINDS[kind] ?? kind;
}

function updateRow(status: DaemonUpdateStatus): DaemonSettingsView["update"] {
  const { state } = status;
  switch (state.kind) {
    case "idle":
      return { text: "Up to date", tone: "success" };
    case "checking":
      return { text: "Checking for updates…", tone: "muted" };
    case "available":
      return {
        text: `Daemon ${state.version} is available.`,
        tone: "attention",
        action: "Update…",
      };
    case "installing":
    case "updating_extensions":
    case "restarting":
      return {
        text: `Updating to ${state.version}…`,
        tone: "muted",
        action: "Show progress",
      };
    case "failed":
      return {
        text: `${failureCodeText(state.code)}; the daemon stays on ${status.currentVersion}.`,
        tone: "danger",
        action: "Details",
      };
    case "cannot_update":
      if (state.version === undefined) return { text: "Up to date", tone: "success" };
      return {
        text: `Daemon ${state.version} is available. ${unavailableReasonText(state.reason)}`,
        tone: "muted",
        action: "How to update",
      };
  }
}

export function daemonSettingsView(input: DaemonSettingsInput): DaemonSettingsView {
  const { status, pendingAutoCheck, now } = input;
  const kind = status.state.kind;
  const running = kind === "installing" || kind === "updating_extensions" || kind === "restarting";
  const view: DaemonSettingsView = {
    version: status.currentVersion,
    installKind: installKindText(status.installKind),
    lastChecked: lastCheckedText(status.checkedAt, now),
    autoCheck: pendingAutoCheck ?? status.autoCheck,
    checkDisabled: kind === "checking" || running,
    update: updateRow(status),
  };
  if (status.checkError !== undefined) view.checkError = checkErrorText(status.checkError);
  return view;
}
