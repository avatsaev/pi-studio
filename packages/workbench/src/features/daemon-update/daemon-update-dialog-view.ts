/**
 * What the daemon update dialog shows, as pure data (`swe/features/self-update.md` § Workbench:
 * Dialog, Reload note). One function from the daemon's status, the impact counts, the page's own
 * version and the host kind to a view; the component only draws it and wires the buttons.
 *
 * The order of precedence: a result being shown wins; then the update's progress (the status says
 * so, or the status is gone because the daemon is restarting — `wasUpdating`); then a failure or
 * an install that cannot update itself; then the offer to update; then "nothing to do".
 */

import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";
import {
  failureCodeText,
  unavailableReasonText,
} from "../connection/daemon-update-presentation.js";

export type DaemonUpdateResult = NonNullable<DaemonUpdateStatus["lastResult"]>;

/** What an update would stop. `terminals` is `null` until the daemon's list has answered. */
export interface UpdateImpact {
  agents: number;
  terminals: number | null;
}

export interface DaemonUpdateDialogInput {
  /** `null` while disconnected, or before the first answer after a (re)connect. */
  status: DaemonUpdateStatus | null;
  impact: UpdateImpact;
  /** The version of the page itself (`host.app.version`); empty when the host does not say. */
  pageVersion: string;
  /** `desktop` ships its own matching web layer, so it never shows the reload note. */
  hostKind: "browser" | "desktop";
  /** A result to show once (unseen by this client); it replaces every other view. */
  result: DaemonUpdateResult | null;
  /** The dialog saw the update running and the status is not (back) yet: the daemon restarts. */
  wasUpdating: boolean;
}

export type StageState = "done" | "active" | "pending";

export interface StageView {
  label: string;
  state: StageState;
}

export type ResultTone = "success" | "warning" | "danger";

export type DaemonUpdateDialogView =
  | {
      kind: "confirm";
      title: string;
      /** "0.0.129 → 0.0.130" */
      versions: string;
      impact: string;
    }
  | {
      kind: "progress";
      title: string;
      stages: StageView[];
    }
  | {
      /** The daemon is restarting and this client is (or just was) disconnected. */
      kind: "restarting";
      title: string;
      stages: StageView[];
      note: string;
    }
  | {
      kind: "result";
      title: string;
      text: string;
      message?: string;
      tone: ResultTone;
      /** A Reload button and `reloadNote` beside it: the page is older than the daemon. */
      reload: boolean;
      reloadNote?: string;
    }
  | {
      kind: "cannot_update";
      title: string;
      text: string;
      command: string;
      version?: string;
    }
  | {
      kind: "failed";
      title: string;
      text: string;
      message?: string;
      command: string;
    }
  | { kind: "none"; title: string; text: string };

const TITLE = "Update the daemon";

/** The hand-run update, shown beside a failure (the same pair every `cannot_update` command names). */
export const MANUAL_UPDATE_COMMAND = "npm i -g @av-pi-studio/cli@latest\npi-studio daemon restart";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Agents whose work an update would cut off: the ones mid-turn (or still starting). */
export function countRunningAgents(statuses: Iterable<string>): number {
  let count = 0;
  for (const status of statuses) {
    if (status === "running" || status === "initializing") count++;
  }
  return count;
}

/**
 * Agents the daemon's own list (`list_agents_request`) says are mid-turn. The session store only
 * learns of an agent another client started after this client connected on its next restore, so
 * the daemon's list is the count that matches what an update would stop.
 */
export function countRunningListedAgents(agents: ReadonlyArray<{ status?: string }>): number {
  return countRunningAgents(agents.map((agent) => agent.status ?? "idle"));
}

/** Terminals the daemon's list says are alive (`list_terminals_request` carries closed ones too). */
export function countLiveTerminals(terminals: ReadonlyArray<{ closed?: boolean }>): number {
  return terminals.filter((terminal) => !terminal.closed).length;
}

export function impactText(impact: UpdateImpact): string {
  if (impact.terminals === null) {
    return impact.agents === 0
      ? "Counting open terminals…"
      : `${plural(impact.agents, "agent")} running will stop. Counting open terminals…`;
  }
  if (impact.agents === 0 && impact.terminals === 0) {
    return "No agents are running and no terminals are open.";
  }
  return `${plural(impact.agents, "agent")} running, ${plural(impact.terminals, "terminal")} open will stop.`;
}

function stages(version: string, active: 0 | 1 | 2): StageView[] {
  const labels = [
    `Installing ${version}`,
    "Updating the Pi extensions",
    "Restarting the daemon",
  ] as const;
  return labels.map((label, index) => ({
    label,
    state: index < active ? "done" : index === active ? "active" : "pending",
  }));
}

function resultView(
  result: DaemonUpdateResult,
  input: Pick<DaemonUpdateDialogInput, "pageVersion" | "hostKind">,
): DaemonUpdateDialogView {
  const message = result.message ? { message: result.message } : {};
  if (result.outcome === "updated") {
    const reload =
      input.hostKind === "browser" && input.pageVersion !== "" && input.pageVersion !== result.to;
    return {
      kind: "result",
      title: TITLE,
      text: `Updated to ${result.to}`,
      tone: "success",
      reload,
      ...(reload
        ? {
            reloadNote: `This page is version ${input.pageVersion}, older than the daemon. Reload to get the matching one.`,
          }
        : {}),
      ...message,
    };
  }
  if (result.outcome === "rolled_back") {
    return {
      kind: "result",
      title: TITLE,
      text: `The update failed; the daemon is back on ${result.from}`,
      tone: "warning",
      reload: false,
      ...message,
    };
  }
  return {
    kind: "result",
    title: TITLE,
    text: `The update to ${result.to} failed`,
    tone: "danger",
    reload: false,
    ...message,
  };
}

export function daemonUpdateDialogView(input: DaemonUpdateDialogInput): DaemonUpdateDialogView {
  const { status, result } = input;
  if (result) return resultView(result, input);

  if (!status) {
    return input.wasUpdating
      ? {
          kind: "restarting",
          title: TITLE,
          stages: [
            { label: "Installing the new version", state: "done" },
            { label: "Updating the Pi extensions", state: "done" },
            { label: "Restarting the daemon", state: "active" },
          ],
          note: "Waiting for the daemon to come back. This page reconnects by itself.",
        }
      : { kind: "none", title: TITLE, text: "The daemon's update status is not available." };
  }

  const { state } = status;
  switch (state.kind) {
    case "installing":
      return { kind: "progress", title: TITLE, stages: stages(state.version, 0) };
    case "updating_extensions":
      return { kind: "progress", title: TITLE, stages: stages(state.version, 1) };
    case "restarting":
      return {
        kind: "restarting",
        title: TITLE,
        stages: stages(state.version, 2),
        note: "The daemon is restarting. This page reconnects by itself.",
      };
    case "failed":
      return {
        kind: "failed",
        title: TITLE,
        text: `${failureCodeText(state.code)}; the daemon stays on ${status.currentVersion}.`,
        ...(state.message ? { message: state.message } : {}),
        command: MANUAL_UPDATE_COMMAND,
      };
    case "cannot_update":
      return {
        kind: "cannot_update",
        title: TITLE,
        text: unavailableReasonText(state.reason),
        command: state.command,
        ...(state.version === undefined ? {} : { version: state.version }),
      };
    case "available":
      return {
        kind: "confirm",
        title: TITLE,
        versions: `${status.currentVersion} → ${state.version}`,
        impact: impactText(input.impact),
      };
    case "idle":
    case "checking":
      return {
        kind: "none",
        title: TITLE,
        text: `The daemon is up to date (${status.currentVersion}).`,
      };
  }
}
