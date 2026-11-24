/**
 * What the Daemons screen draws, decided from the registry snapshot and the error the daemons
 * store holds: one row per entry with the actions that apply to it, the local entry's state and
 * its notice, the banner, and the two settings' field rules.
 *
 * Pure — no React, no host access — so it is unit-testable in the node env
 * (`swe/features/desktop-daemon-registry.md` § Public contract 4, § Error handling & edge cases).
 */

import { type DaemonEntryView, type RemoteDaemonState } from "../../host/types.js";
import {
  MIN_REMOTE_CLI_VERSION,
  REMOTE_INSTALL_COMMAND,
  daemonErrorView,
  daemonFailureOf,
  isInstallFailure,
  localStateView,
  remoteStateView,
  type DaemonFailure,
  type LocalAction,
  type LocalTone,
  type RemoteAction,
} from "./daemon-presentation.js";
import { type DaemonsSnapshot } from "./use-daemons.js";

export type EntryAction = "open" | "replaceLink" | "edit" | "remove";

export const LINK_INVALID_LABEL = "Pairing link no longer valid";

/** A short explanation under the local entry's state, with a command the user can run. */
export interface LocalNotice {
  text: string;
  command?: string;
  /** The last lines of what a failed update or install printed; shown as is. */
  output?: string;
}

export const OUTPUT_MAX_LINES = 8;
export const OUTPUT_MAX_CHARS = 600;

/**
 * The tail of what a failed install or update printed, as plain text for the row: the last
 * `OUTPUT_MAX_LINES` non-empty lines, and at most the last `OUTPUT_MAX_CHARS` characters (cut with
 * a leading "…"). `undefined` when nothing is left.
 */
export function truncateOutput(output: string | undefined): string | undefined {
  const lines = (output ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .slice(-OUTPUT_MAX_LINES);
  if (lines.length === 0) return undefined;
  const text = lines.join("\n");
  return text.length <= OUTPUT_MAX_CHARS ? text : `…${text.slice(-OUTPUT_MAX_CHARS)}`;
}

/** What the SSH row says under "The update failed": the command to run by hand, and the last lines `pi-studio update` printed. */
function updateFailedNotice(command: string, output: string | undefined): LocalNotice {
  const lines = truncateOutput(output);
  return {
    text: "Run the update yourself, then retry.",
    command,
    ...(lines === undefined ? {} : { output: lines }),
  };
}

const INSTALL_FAILED_TEXTS: Record<
  "download_failed" | "checksum_mismatch" | "install_failed",
  string
> = {
  download_failed: "Check the internet connection, then retry.",
  checksum_mismatch: "The file was not unpacked. Retry downloads it again.",
  install_failed: "Retry installs the daemon again.",
};

/** What the local row says under a failed download or install: what Retry does, and what the install printed. */
function installFailedNotice(
  reason: keyof typeof INSTALL_FAILED_TEXTS,
  output: string | undefined,
): LocalNotice {
  const lines = truncateOutput(output);
  return {
    text: INSTALL_FAILED_TEXTS[reason],
    ...(lines === undefined ? {} : { output: lines }),
  };
}

export interface LocalRowView {
  label: string;
  tone: LocalTone;
  actions: LocalAction[];
  notice: LocalNotice | null;
}

export interface RemoteRowView {
  label: string;
  tone: LocalTone;
  actions: RemoteAction[];
  /** For a missing or outdated CLI: the text and the command to copy. */
  notice: LocalNotice | null;
}

export interface EntryRowView {
  id: string;
  name: string;
  /** "This machine", "Address", "Relay" or "SSH". */
  kindLabel: string;
  /** A direct entry's address as typed, or an SSH entry's `user@host:port`; `null` for the others. */
  address: string | null;
  current: boolean;
  /** A relay entry whose pairing link stopped working (memory only); the row offers "Replace link". */
  linkInvalid: boolean;
  /** In display order. `open` is absent on the current entry, `remove` on the local one. */
  actions: EntryAction[];
  /** The local entry's state and actions; `null` for every other entry. */
  local: LocalRowView | null;
  /** The current SSH entry's state and actions; `null` for every other entry. */
  remote: RemoteRowView | null;
}

export interface BannerView {
  message: string;
  detail?: string;
  command?: string;
  /** `info`: a plain state (the local daemon is stopped by choice), not drawn as an error. */
  tone: "error" | "info";
}

export interface DaemonsScreenView {
  rows: EntryRowView[];
  banner: BannerView | null;
  /** One line under the list when the host keeps secrets in a file; `null` otherwise. */
  secretStoreNote: string | null;
}

export const FILE_SECRET_STORE_NOTE =
  "Passwords and pairing links are kept in a file only this user can read, because no keychain is available.";

const KIND_LABELS: Record<DaemonEntryView["kind"], string> = {
  local: "This machine",
  direct: "Address",
  relay: "Relay",
  ssh: "SSH",
};

const NO_LINKS: ReadonlySet<string> = new Set();

function localNotice(local: DaemonsSnapshot["local"]): LocalNotice | null {
  switch (local.state) {
    case "unsupported": {
      const detail = daemonErrorView("unsupported").detail;
      return detail === undefined ? null : { text: detail };
    }
    case "outdated":
      return {
        text: `Found version ${local.version}. Update installs the version this app was built with and starts it; Retry looks again.`,
      };
    case "failed":
      return isInstallFailure(local.reason)
        ? installFailedNotice(local.reason, local.output)
        : null;
    default:
      return null;
  }
}

/** What the row shows under the name: a direct entry's address as typed, an SSH entry's `user@host:port`. */
function entryAddress(entry: DaemonEntryView): string | null {
  if (entry.kind === "direct") return entry.address ? entry.address : null;
  if (entry.kind !== "ssh" || entry.ssh === undefined) return null;
  const { host, user, port } = entry.ssh;
  return `${user === undefined ? "" : `${user}@`}${host}${port === undefined ? "" : `:${port}`}`;
}

/** The SSH entry's explanation under its state; the command is offered with a Copy button (D22). */
export function remoteNotice(remote: RemoteDaemonState): LocalNotice | null {
  switch (remote.state) {
    case "not_installed":
      return {
        text: "Install it on the host (it needs Node.js), then retry.",
        command: REMOTE_INSTALL_COMMAND,
      };
    case "cli_outdated":
      return {
        text: `Found version ${remote.version}; version ${MIN_REMOTE_CLI_VERSION} or newer is needed. Update it on the host, then retry.`,
        command: REMOTE_INSTALL_COMMAND,
      };
    case "failed":
      return remote.reason === "update_failed"
        ? updateFailedNotice(REMOTE_INSTALL_COMMAND, remote.output)
        : null;
    default:
      return null;
  }
}

function entryRow(
  entry: DaemonEntryView,
  snapshot: DaemonsSnapshot,
  invalidLinks: ReadonlySet<string>,
): EntryRowView {
  const current = entry.id === snapshot.currentId;
  const isLocal = entry.kind === "local";
  const linkInvalid = entry.kind === "relay" && invalidLinks.has(entry.id);
  const actions: EntryAction[] = [];
  if (!current) actions.push("open");
  if (linkInvalid) actions.push("replaceLink");
  actions.push("edit");
  if (!isLocal) actions.push("remove");

  let local: LocalRowView | null = null;
  if (isLocal) {
    const state = localStateView(snapshot.local);
    local = {
      label: state.label,
      tone: state.tone,
      actions: state.actions,
      notice: localNotice(snapshot.local),
    };
  }
  let remote: RemoteRowView | null = null;
  if (entry.kind === "ssh" && current && snapshot.remote !== null) {
    const state = remoteStateView(snapshot.remote);
    remote = {
      label: state.label,
      tone: state.tone,
      actions: state.actions,
      notice: remoteNotice(snapshot.remote),
    };
  }
  return {
    id: entry.id,
    name: entry.name,
    kindLabel: KIND_LABELS[entry.kind],
    address: entryAddress(entry),
    current,
    linkInvalid,
    actions,
    local,
    remote,
  };
}

/** The banner for the error the store holds, with what the snapshot adds (the outdated CLI's version). */
export function bannerView(
  error: DaemonFailure | null,
  local: DaemonsSnapshot["local"],
): BannerView | null {
  if (error === null) return null;
  const view = daemonErrorView(error);
  let detail = view.detail;
  if (error === "outdated" && local.state === "outdated") {
    detail = `Found version ${local.version}. ${detail ?? ""}`.trim();
  }
  return {
    message: view.message,
    ...(detail === undefined ? {} : { detail }),
    ...(view.command === undefined ? {} : { command: view.command }),
    tone: view.isError ? "error" : "info",
  };
}

export function buildDaemonsScreenView(
  snapshot: DaemonsSnapshot,
  error: DaemonFailure | null,
  invalidLinks: ReadonlySet<string> = NO_LINKS,
): DaemonsScreenView {
  return {
    rows: snapshot.entries.map((entry) => entryRow(entry, snapshot, invalidLinks)),
    banner: bannerView(error, snapshot.local),
    secretStoreNote: snapshot.secretStore === "file" ? FILE_SECRET_STORE_NOTE : null,
  };
}

/** The message under a settings field when the host refused the value. */
export function settingsFailureText(error: unknown): string {
  const code = daemonFailureOf(error);
  if (code !== "unexpected") return daemonErrorView(code).message;
  const message =
    typeof error === "object" && error !== null && "message" in error ? error.message : undefined;
  return typeof message === "string" && message.trim() !== ""
    ? message
    : "This setting could not be saved.";
}
