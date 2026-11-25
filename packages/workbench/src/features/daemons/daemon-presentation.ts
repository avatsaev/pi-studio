/**
 * The words and the rules the daemon switcher and the Daemons screen share: what a local daemon
 * state is called and which actions apply to it, and what each `DaemonError` code means to a user.
 *
 * Pure — no React, no store access — so it is unit-testable in the node env
 * (`swe/features/desktop-daemon-registry.md` § Error handling & edge cases).
 */

import {
  type DaemonErrorCode,
  type LocalDaemonState,
  type RemoteDaemonState,
} from "../../host/types.js";

/** What the user can ask of the local daemon. */
export type LocalActionKind = "start" | "stop" | "restart" | "retry" | "update";

export interface LocalAction {
  kind: LocalActionKind;
  label: string;
  /** The `HostDaemons.local` member to call: Retry re-probes an outdated daemon and starts a failed one (installing it first when needed) again. */
  call: "start" | "stop" | "restart" | "refresh" | "update";
}

/** `error`: something went wrong; `busy`: an action is running; `ok`: up; `neutral`: nothing to flag. */
export type LocalTone = "neutral" | "busy" | "ok" | "error";

export interface LocalStateView {
  label: string;
  tone: LocalTone;
  /** In display order. Empty while the state is transient or nothing can be done. */
  actions: LocalAction[];
}

const START: LocalAction = { kind: "start", label: "Start", call: "start" };
const STOP: LocalAction = { kind: "stop", label: "Stop", call: "stop" };
const RESTART: LocalAction = { kind: "restart", label: "Restart", call: "restart" };
/** For an outdated daemon: look again after the user updated it by hand. */
const RETRY_PROBE: LocalAction = { kind: "retry", label: "Retry", call: "refresh" };
/** For a failed start or install: install the pin if it is missing, then start the daemon again. */
const RETRY_START: LocalAction = { kind: "retry", label: "Retry", call: "start" };
/** Installs the version the app was built with, then starts the daemon. Offered for `outdated` only: Start already installs the pin when it is missing. */
const UPDATE: LocalAction = { kind: "update", label: "Update", call: "update" };

type LocalFailReason = Extract<LocalDaemonState, { state: "failed" }>["reason"];

/** The daemon's refusals to start: the same words for a local daemon and a host's. */
const UNPROTECTED_BIND_LABEL = "Not started: no password on a network address";
const CONFIG_UNREADABLE_LABEL = "Not started: the configuration file is damaged";

const FAILED_LABELS: Record<LocalFailReason, string> = {
  not_healthy: "Started, but not answering",
  timeout: "Did not start in time",
  bad_output: "The daemon printed something unexpected",
  spawn_failed: "The daemon could not be run",
  download_failed: "The download failed",
  checksum_mismatch: "The file did not match its checksum and was deleted",
  install_failed: "Installing the daemon failed",
  unprotected_bind: UNPROTECTED_BIND_LABEL,
  config_unreadable: CONFIG_UNREADABLE_LABEL,
};

/** The failures of getting the daemon onto the machine; Retry runs the install again. */
export function isInstallFailure(
  reason: LocalFailReason,
): reason is "download_failed" | "checksum_mismatch" | "install_failed" {
  return (
    reason === "download_failed" || reason === "checksum_mismatch" || reason === "install_failed"
  );
}

/** "Downloading the daemon · 42 %"; no share while the size is unknown. */
function downloadingLabel(received: number, total: number): string {
  if (total <= 0) return "Downloading the daemon";
  return `Downloading the daemon · ${Math.min(100, Math.floor((received / total) * 100))} %`;
}

/** `host:port`, bracketing an IPv6 literal. */
function hostPort(host: string, port: number): string {
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

export function localStateView(state: LocalDaemonState): LocalStateView {
  switch (state.state) {
    case "checking":
      return { label: "Checking…", tone: "busy", actions: [] };
    case "unsupported":
      return { label: "Not available on this system", tone: "error", actions: [] };
    case "outdated":
      return {
        label: `The pi-studio daemon ${state.version} is too old`,
        tone: "error",
        actions: [UPDATE, RETRY_PROBE],
      };
    case "downloading":
      return { label: downloadingLabel(state.received, state.total), tone: "busy", actions: [] };
    case "installing":
      return { label: "Installing the daemon", tone: "busy", actions: [] };
    case "stopped":
      return { label: "Stopped", tone: "neutral", actions: [START] };
    case "starting":
      return { label: "Starting…", tone: "busy", actions: [] };
    case "stopping":
      return { label: "Stopping…", tone: "busy", actions: [] };
    case "running":
      return {
        label: `Running on ${hostPort(state.host, state.port)}`,
        tone: "ok",
        actions: [STOP, RESTART],
      };
    case "updating":
      return { label: "Updating…", tone: "busy", actions: [] };
    case "failed":
      return {
        label: FAILED_LABELS[state.reason],
        tone: "error",
        actions: [RETRY_START],
      };
  }
}

/** What the user can ask of the current SSH entry's daemon. */
export interface RemoteAction {
  kind: "start" | "retry" | "install" | "update";
  label: string;
  /** The `HostDaemons.remote` member to call: Retry after a failed install installs again, a failed start starts again. */
  call: "start" | "refresh" | "install" | "update";
}

export interface RemoteStateView {
  label: string;
  tone: LocalTone;
  /** In display order. Empty while the state is transient, already running, or not supported. */
  actions: RemoteAction[];
}

type RemoteFailReason = Extract<RemoteDaemonState, { state: "failed" }>["reason"];
type RemoteInstallFailReason =
  | "download_failed"
  | "checksum_mismatch"
  | "send_failed"
  | "install_failed";

const REMOTE_START: RemoteAction = { kind: "start", label: "Start", call: "start" };
/** For an unknown state: look at the host. */
const REMOTE_PROBE: RemoteAction = { kind: "retry", label: "Retry", call: "refresh" };
/** For a failed start: start the daemon again. */
const REMOTE_RETRY_START: RemoteAction = { kind: "retry", label: "Retry", call: "start" };
/** For a failed install: run the install again. */
const REMOTE_RETRY_INSTALL: RemoteAction = { kind: "retry", label: "Retry", call: "install" };
/** Puts the daemon the app was built with on the host, then starts it. */
const REMOTE_INSTALL: RemoteAction = { kind: "install", label: "Install", call: "install" };
/** Installs the app's daemon on the host and restarts the daemon on it. */
const REMOTE_UPDATE: RemoteAction = { kind: "update", label: "Update", call: "update" };

const REMOTE_FAILED_LABELS: Record<RemoteFailReason, string> = {
  not_healthy: "Started, but not answering",
  timeout: "Did not start in time",
  bad_output: "The pi-studio daemon printed something unexpected",
  exec_failed: "Could not run a command on the host",
  no_shell: "The host's login shell could not be used",
  download_failed: "The download failed",
  checksum_mismatch: "The file did not match its checksum and was deleted",
  send_failed: "Sending the daemon to the host failed",
  install_failed: "Installing the daemon on the host failed",
  unprotected_bind: UNPROTECTED_BIND_LABEL,
  config_unreadable: CONFIG_UNREADABLE_LABEL,
};

/** The failures of getting the daemon onto the host; Retry runs the install again. */
export function isRemoteInstallFailure(
  reason: RemoteFailReason,
): reason is RemoteInstallFailReason {
  return (
    reason === "download_failed" ||
    reason === "checksum_mismatch" ||
    reason === "send_failed" ||
    reason === "install_failed"
  );
}

const INSTALLING_LABELS: Record<
  Extract<RemoteDaemonState, { state: "installing" }>["stage"],
  string
> = {
  downloading: "Downloading the daemon",
  sending: "Sending the daemon to the host",
  unpacking: "Unpacking the daemon on the host",
  starting: "Starting the daemon",
};

/** "Sending the daemon to the host · 42 %"; no share while the size is not known. */
function installingLabel(state: Extract<RemoteDaemonState, { state: "installing" }>): string {
  const label = INSTALLING_LABELS[state.stage];
  const { done, total } = state;
  if (done === undefined || total === undefined || total <= 0) return label;
  return `${label} · ${Math.min(100, Math.floor((done / total) * 100))} %`;
}

export function remoteStateView(state: RemoteDaemonState): RemoteStateView {
  switch (state.state) {
    case "unknown":
      return { label: "Not checked yet", tone: "neutral", actions: [REMOTE_PROBE] };
    case "checking":
      return { label: "Checking…", tone: "busy", actions: [] };
    case "running":
      return { label: "Running", tone: "ok", actions: [] };
    case "stopped":
      return { label: "Stopped", tone: "neutral", actions: [REMOTE_START, REMOTE_UPDATE] };
    case "starting":
      return { label: "Starting…", tone: "busy", actions: [] };
    case "not_installed":
      return {
        label: "pi-studio is not installed on this host",
        tone: "error",
        actions: [REMOTE_INSTALL],
      };
    case "outdated":
      return {
        label: `The pi-studio daemon ${state.version} on this host is too old`,
        tone: "error",
        actions: [REMOTE_UPDATE, REMOTE_PROBE],
      };
    case "unsupported":
      return {
        label: `This system is not supported (${state.system})`,
        tone: "error",
        actions: [],
      };
    case "installing":
      return { label: installingLabel(state), tone: "busy", actions: [] };
    case "failed":
      return {
        label: REMOTE_FAILED_LABELS[state.reason],
        tone: "error",
        actions: [isRemoteInstallFailure(state.reason) ? REMOTE_RETRY_INSTALL : REMOTE_RETRY_START],
      };
  }
}

/** The states in which the Daemons screen opens by itself (S8): the user has something to do. */
export function remoteNeedsScreen(state: RemoteDaemonState["state"] | null): boolean {
  return (
    state === "stopped" ||
    state === "not_installed" ||
    state === "outdated" ||
    state === "unsupported" ||
    state === "failed"
  );
}

/** A code the workbench could not map, e.g. a host that rejected with something else. */
export type DaemonFailure = DaemonErrorCode | "unexpected";

export interface DaemonErrorView {
  /** One sentence for the banner or the form. */
  message: string;
  /** A second sentence explaining why or what to do, when the message alone is not enough. */
  detail?: string;
  /** `false`: a plain state, not drawn as an error (the local daemon is stopped by choice). */
  isError: boolean;
}

const ERROR_VIEWS: Record<DaemonFailure, Omit<DaemonErrorView, "isError"> & { isError?: false }> = {
  invalid_name: { message: "The name must be 1 to 64 characters." },
  name_taken: { message: "Another daemon already has this name." },
  invalid_address: { message: "This is not a valid daemon address." },
  invalid_link: { message: "This is not a valid pairing link." },
  too_many: { message: "No more than 64 daemons can be saved." },
  not_found: { message: "This daemon no longer exists." },
  wrong_kind: { message: "This change does not apply to this kind of daemon." },
  local_not_removable: { message: "The local daemon cannot be removed." },
  unsupported: {
    message: "A local daemon is not available here.",
    detail:
      "Running a daemon on this machine needs macOS, Linux or WSL. Add a remote daemon instead.",
  },
  outdated: {
    message: "The pi-studio daemon is too old.",
    detail: "Update it, then retry.",
  },
  install_not_offered: {
    message: "The daemon cannot be installed now.",
    detail:
      "Install is offered when nothing is installed, the daemon is stopped, or an install failed.",
  },
  busy: { message: "Another action on the local daemon is still running." },
  no_current: { message: "No daemon is selected.", detail: "Pick one or add one.", isError: false },
  local_stopped: {
    message: "The local daemon is stopped.",
    detail: "Start it to connect.",
    isError: false,
  },
  not_healthy: { message: "The daemon started but is not answering." },
  timeout: { message: "The daemon did not start in time." },
  bad_output: { message: "pi-studio printed something unexpected." },
  spawn_failed: { message: "The daemon could not be run." },
  download_failed: { message: "The download failed." },
  checksum_mismatch: { message: "The file did not match its checksum and was deleted." },
  install_failed: { message: "Installing the daemon failed." },
  unprotected_bind: {
    message: "The daemon did not start: it would listen beyond its machine with no password.",
    detail: "Set a password or make it listen on 127.0.0.1 only, then retry.",
  },
  config_unreadable: {
    message: "The daemon did not start: its configuration file is damaged.",
    detail: "Repair or remove the file, then retry.",
  },
  secret_missing: {
    message: "The saved password or pairing link for this daemon was not found.",
    detail: "Edit the daemon and enter it again.",
  },
  secret_unavailable: {
    message: "Pi Studio could not read its saved passwords.",
    detail: "Check that your keychain is unlocked, then try again.",
  },
  secret_store_failed: {
    message: "The password or pairing link could not be saved.",
    detail: "Nothing was changed. Check that your keychain is unlocked, then try again.",
  },
  invalid_host: { message: "This is not a valid host name or address." },
  invalid_user: { message: "This is not a valid user name." },
  invalid_port: { message: "The port must be a number from 1 to 65535." },
  invalid_path: { message: "This is not a valid file path." },
  invalid_jump: { message: "This is not a valid jump host." },
  not_installed: { message: "pi-studio is not installed on this host." },
  ssh_config: {
    message: "~/.ssh/config could not be read.",
    detail: "Fix the file (a ProxyCommand is not supported), then try again.",
  },
  unexpected: { message: "The daemon could not be opened." },
};

/** Every code the host can reject with, for tests and exhaustive UI (the table above is typed to cover them all). */
export const DAEMON_ERROR_CODES = Object.keys(ERROR_VIEWS).filter(
  (code): code is DaemonErrorCode => code !== "unexpected",
);

export function daemonErrorView(code: DaemonFailure): DaemonErrorView {
  return { isError: true, ...ERROR_VIEWS[code] };
}

export function isDaemonErrorCode(value: unknown): value is DaemonErrorCode {
  return typeof value === "string" && value !== "unexpected" && Object.hasOwn(ERROR_VIEWS, value);
}

/** The code a `HostDaemons` call rejected with, or `unexpected` for anything else. */
export function daemonFailureOf(error: unknown): DaemonFailure {
  if (typeof error === "object" && error !== null && "code" in error) {
    return isDaemonErrorCode(error.code) ? error.code : "unexpected";
  }
  return "unexpected";
}
