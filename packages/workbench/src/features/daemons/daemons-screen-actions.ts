/**
 * What the Daemons screen's buttons do against the host: open an entry, run a local daemon action,
 * remove an entry after a confirm, save a setting. Each call reports the failure code a banner can
 * word (`DaemonFailure`) or `null`; none throws, so the component only sets state.
 *
 * Plain functions over `HostDaemons` / `HostDialogs` — unit-testable with the in-memory registry
 * (`test/test-daemons.ts`) and `createTestHost`.
 */

import { type ConnectionState } from "@av-pi-studio/client";
import {
  type DaemonSettings,
  type HostClipboard,
  type HostDaemons,
  type HostDialogs,
  type LocalDaemonState,
} from "../../host/types.js";
import {
  daemonFailureOf,
  isInstallFailure,
  type DaemonFailure,
  type LocalAction,
  type RemoteAction,
} from "./daemon-presentation.js";
import { settingsFailureText } from "./daemons-screen-view.js";

/** What a `HostDaemons` call that has no value to return came to. */
export type ActionOutcome = DaemonFailure | null;

async function failureOf(call: () => Promise<void>): Promise<ActionOutcome> {
  try {
    await call();
    return null;
  } catch (error) {
    return daemonFailureOf(error);
  }
}

/**
 * Open an entry. The host reloads the page on success, so the promise never resolves then; a
 * rejection (the entry vanished) is the only thing to report.
 */
export function openEntry(daemons: HostDaemons, id: string): Promise<ActionOutcome> {
  return failureOf(() => daemons.switchTo(id));
}

/** Start, stop, restart or re-probe the local daemon. Acceptance only: the outcome is a state change. */
export function runLocalAction(
  daemons: HostDaemons,
  call: LocalAction["call"],
): Promise<ActionOutcome> {
  return failureOf(() => daemons.local[call]());
}

/**
 * Whether opening the Daemons screen re-reads the local daemon's state (`local.refresh()`). Not after a failed
 * install: the read is an install too (every local action first makes sure the pinned binary is in place), so the
 * screen that opens *because* the download failed would download the archive again at once, before anyone pressed
 * Retry (live run, sprint-145/task-001: a corrupted archive was fetched twice, 18 ms apart). The row names what failed
 * and offers Retry. Every other state is re-read: it may have changed while the screen was closed.
 */
export function refreshesOnOpen(local: LocalDaemonState): boolean {
  return !(local.state === "failed" && isInstallFailure(local.reason));
}

/** Start the current SSH entry's daemon, or probe its host again. Acceptance only: the outcome is a state change. */
export function runRemoteAction(
  daemons: HostDaemons,
  call: RemoteAction["call"],
): Promise<ActionOutcome> {
  return failureOf(() => daemons.remote[call]());
}

/** Copy a command through the host's clipboard; a refusal is reported as the banner's `unexpected`. */
export function copyCommand(clipboard: HostClipboard, command: string): Promise<ActionOutcome> {
  return failureOf(() => clipboard.writeText(command));
}

export const STOP_CONFIRM_MESSAGE = "Agents running on this daemon will stop.";

/** Stopping the daemon this window is connected to ends the connection, so it is asked first. */
export function stopNeedsConfirm(
  call: LocalAction["call"],
  onCurrentEntry: boolean,
  status: ConnectionState,
): boolean {
  return call === "stop" && onCurrentEntry && status === "open";
}

/** `runLocalAction`, after a confirm when `ask` is set. Answering no does nothing and reports nothing. */
export async function runLocalActionAsking(
  daemons: HostDaemons,
  dialogs: HostDialogs,
  call: LocalAction["call"],
  ask: boolean,
): Promise<ActionOutcome> {
  if (ask && !(await dialogs.confirm(STOP_CONFIRM_MESSAGE))) return null;
  return runLocalAction(daemons, call);
}

export function removeConfirmMessage(name: string): string {
  return `Remove "${name}"? Its saved password or pairing link and its stored layout are deleted.`;
}

/** Ask, then remove. Answering no removes nothing and reports nothing. */
export async function removeEntry(
  daemons: HostDaemons,
  dialogs: HostDialogs,
  entry: { id: string; name: string },
): Promise<ActionOutcome> {
  if (!(await dialogs.confirm(removeConfirmMessage(entry.name)))) return null;
  return failureOf(() => daemons.remove(entry.id));
}

/** `null` on success; else the reason the host gave, to show under the field. */
export type SettingsOutcome = string | null;

async function saveSettings(
  daemons: HostDaemons,
  patch: Partial<DaemonSettings>,
): Promise<SettingsOutcome> {
  try {
    await daemons.setSettings(patch);
    return null;
  } catch (error) {
    return settingsFailureText(error);
  }
}

export function saveAutoStart(daemons: HostDaemons, enabled: boolean): Promise<SettingsOutcome> {
  return saveSettings(daemons, { autoStartLocalDaemon: enabled });
}
