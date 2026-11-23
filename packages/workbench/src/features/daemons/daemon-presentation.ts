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
export type LocalActionKind = "start" | "stop" | "restart" | "retry";

export interface LocalAction {
  kind: LocalActionKind;
  label: string;
  /** The `HostDaemons.local` member to call: Retry re-probes a missing or outdated CLI and starts a failed daemon again. */
  call: "start" | "stop" | "restart" | "refresh";
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
/** For a CLI that is missing or outdated: look again after the user installed or updated it. */
const RETRY_PROBE: LocalAction = { kind: "retry", label: "Retry", call: "refresh" };
/** For a daemon that failed to start: start it again. */
const RETRY_START: LocalAction = { kind: "retry", label: "Retry", call: "start" };

const FAILED_LABELS: Record<Extract<LocalDaemonState, { state: "failed" }>["reason"], string> = {
  not_healthy: "Started, but not answering",
  timeout: "Did not start in time",
  bad_output: "The pi-studio CLI printed something unexpected",
  spawn_failed: "The pi-studio CLI could not be run",
};

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
    case "cli_missing":
      return {
        label: state.path
          ? `The pi-studio CLI was not found at ${state.path}`
          : "The pi-studio CLI was not found",
        tone: "error",
        actions: [RETRY_PROBE],
      };
    case "cli_outdated":
      return {
        label: `The pi-studio CLI ${state.version} is too old`,
        tone: "error",
        actions: [RETRY_PROBE],
      };
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
    case "failed":
      return { label: FAILED_LABELS[state.reason], tone: "error", actions: [RETRY_START] };
  }
}

/** What the user can ask of the current SSH entry's daemon. */
export interface RemoteAction {
  kind: "start" | "retry";
  label: string;
  /** The `HostDaemons.remote` member to call: Retry probes the host again. */
  call: "start" | "refresh";
}

export interface RemoteStateView {
  label: string;
  tone: LocalTone;
  /** In display order. Empty while the state is transient or already running. */
  actions: RemoteAction[];
}

const REMOTE_START: RemoteAction = { kind: "start", label: "Start", call: "start" };
const REMOTE_RETRY: RemoteAction = { kind: "retry", label: "Retry", call: "refresh" };

const REMOTE_FAILED_LABELS: Record<
  Extract<RemoteDaemonState, { state: "failed" }>["reason"],
  string
> = {
  not_healthy: "Started, but not answering",
  timeout: "Did not start in time",
  bad_output: "The pi-studio CLI printed something unexpected",
  exec_failed: "Could not run a command on the host",
  no_shell: "The host's login shell could not be used",
};

/** The oldest `pi-studio` the desktop app drives on an SSH host (the host's `MIN_CLI_VERSION`). */
export const MIN_REMOTE_CLI_VERSION = "0.0.127";

/** The command that installs (or updates) `pi-studio` on an SSH host. */
export const REMOTE_INSTALL_COMMAND = "npm install -g @av-pi-studio/cli";

export function remoteStateView(state: RemoteDaemonState): RemoteStateView {
  switch (state.state) {
    case "unknown":
      return { label: "Not checked yet", tone: "neutral", actions: [REMOTE_RETRY] };
    case "checking":
      return { label: "Checking…", tone: "busy", actions: [] };
    case "running":
      return { label: "Running", tone: "ok", actions: [] };
    case "stopped":
      return { label: "Stopped", tone: "neutral", actions: [REMOTE_START] };
    case "starting":
      return { label: "Starting…", tone: "busy", actions: [] };
    case "not_installed":
      return {
        label: "pi-studio is not installed on this host",
        tone: "error",
        actions: [REMOTE_RETRY],
      };
    case "cli_outdated":
      return {
        label: `The pi-studio CLI ${state.version} on this host is too old`,
        tone: "error",
        actions: [REMOTE_RETRY],
      };
    case "failed":
      return {
        label: REMOTE_FAILED_LABELS[state.reason],
        tone: "error",
        actions: [REMOTE_START, REMOTE_RETRY],
      };
  }
}

/** The states in which the Daemons screen opens by itself (S8): the user has something to do. */
export function remoteNeedsScreen(state: RemoteDaemonState["state"] | null): boolean {
  return (
    state === "stopped" ||
    state === "not_installed" ||
    state === "cli_outdated" ||
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
  /** A shell command the user can copy. */
  command?: string;
  /** `false`: a plain state, not drawn as an error (the local daemon is stopped by choice). */
  isError: boolean;
}

export const INSTALL_CLI_COMMAND = "npm i -g @av-pi-studio/cli";
export const UPDATE_CLI_COMMAND = "npm i -g @av-pi-studio/cli@latest";

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
  cli_missing: {
    message: "The pi-studio CLI was not found.",
    detail: "Install it (it needs Node.js), then retry.",
    command: INSTALL_CLI_COMMAND,
  },
  cli_outdated: {
    message: "The pi-studio CLI is too old to start a daemon.",
    detail: "Update it, then retry.",
    command: UPDATE_CLI_COMMAND,
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
  bad_output: { message: "The pi-studio CLI printed something unexpected." },
  spawn_failed: { message: "The pi-studio CLI could not be run." },
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
  not_installed: {
    message: "pi-studio is not installed on this host.",
    detail: "Install it there, then retry.",
    command: INSTALL_CLI_COMMAND,
  },
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
