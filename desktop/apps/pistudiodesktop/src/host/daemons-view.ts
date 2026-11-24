import {
  type DaemonEntryView,
  type DaemonSettings,
  type LocalDaemonState,
  type RemoteDaemonState,
  type SshEntryView,
} from "@av-pi-studio/workbench";

/** The registry as the page holds it: what `HostDaemons.snapshot()` returns. No secret is in it. */
export interface DaemonsView {
  currentId: string | null;
  entries: DaemonEntryView[];
  local: LocalDaemonState;
  remote: RemoteDaemonState | null;
  settings: DaemonSettings;
  /** Absent when the app does not say, or says something else. */
  secretStore?: "keychain" | "file";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FAIL_REASONS = [
  "not_healthy",
  "timeout",
  "bad_output",
  "spawn_failed",
  "download_failed",
  "checksum_mismatch",
  "install_failed",
] as const;
const REMOTE_FAIL_REASONS = [
  "not_healthy",
  "timeout",
  "bad_output",
  "exec_failed",
  "no_shell",
  "update_failed",
] as const;
const ENTRY_KINDS = ["local", "direct", "relay", "ssh"] as const;

/** A string, or `undefined` for an absent or null field; `null` for any other type. */
function optionalString(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : null;
}

function parseLocalState(value: unknown): LocalDaemonState | null {
  if (!isRecord(value)) return null;
  switch (value.state) {
    case "checking":
    case "unsupported":
    case "stopped":
    case "starting":
    case "stopping":
    case "updating":
      return { state: value.state };
    case "installing":
      return { state: "installing" };
    case "outdated":
      return typeof value.version === "string" ? { state: "outdated", version: value.version } : null;
    case "downloading":
      return typeof value.received === "number" && typeof value.total === "number"
        ? { state: "downloading", received: value.received, total: value.total }
        : null;
    case "running":
      return typeof value.host === "string" && typeof value.port === "number"
        ? { state: "running", host: value.host, port: value.port }
        : null;
    case "failed": {
      const reason = FAIL_REASONS.find((r) => r === value.reason);
      const output = optionalString(value.output);
      if (!reason || output === null) return null;
      return output === undefined ? { state: "failed", reason } : { state: "failed", reason, output };
    }
    default:
      return null;
  }
}

/** The state of the current `ssh` entry's daemon; `null` for an absent or null field, or an unknown shape. */
function parseRemoteState(value: unknown): RemoteDaemonState | null {
  if (!isRecord(value)) return null;
  switch (value.state) {
    case "unknown":
    case "checking":
    case "running":
    case "stopped":
    case "not_installed":
    case "starting":
    case "updating":
      return { state: value.state };
    case "cli_outdated":
      return typeof value.version === "string" ? { state: "cli_outdated", version: value.version } : null;
    case "failed": {
      const reason = REMOTE_FAIL_REASONS.find((r) => r === value.reason);
      const output = optionalString(value.output);
      if (!reason || output === null) return null;
      return output === undefined ? { state: "failed", reason } : { state: "failed", reason, output };
    }
    default:
      return null;
  }
}

function parseSshView(value: unknown): SshEntryView | null {
  if (!isRecord(value)) return null;
  const user = optionalString(value.user);
  const identityFile = optionalString(value.identityFile);
  const jump = optionalString(value.jump);
  const port = value.port === undefined || value.port === null ? undefined : value.port;
  if (
    typeof value.host !== "string" ||
    typeof value.daemonPort !== "number" ||
    typeof value.hasSshPassword !== "boolean" ||
    typeof value.hasPassphrase !== "boolean" ||
    user === null ||
    identityFile === null ||
    jump === null ||
    (port !== undefined && typeof port !== "number")
  ) {
    return null;
  }
  return {
    host: value.host,
    ...(user === undefined ? {} : { user }),
    ...(port === undefined ? {} : { port }),
    ...(identityFile === undefined ? {} : { identityFile }),
    ...(jump === undefined ? {} : { jump }),
    daemonPort: value.daemonPort,
    hasSshPassword: value.hasSshPassword,
    hasPassphrase: value.hasPassphrase,
  };
}

/** One entry without its secrets, or `null` when it is not the expected shape. */
export function parseEntryView(value: unknown): DaemonEntryView | null {
  if (!isRecord(value)) return null;
  const kind = ENTRY_KINDS.find((k) => k === value.kind);
  const address = optionalString(value.address);
  if (
    typeof value.id !== "string" ||
    !kind ||
    typeof value.name !== "string" ||
    typeof value.hasPassword !== "boolean" ||
    address === null
  ) {
    return null;
  }
  const ssh = value.ssh === undefined || value.ssh === null ? undefined : parseSshView(value.ssh);
  if (ssh === null || (kind === "ssh") !== (ssh !== undefined)) return null;
  return {
    id: value.id,
    kind,
    name: value.name,
    ...(address === undefined ? {} : { address }),
    ...(ssh === undefined ? {} : { ssh }),
    hasPassword: value.hasPassword,
  };
}

function parseSettings(value: unknown): DaemonSettings | null {
  if (!isRecord(value)) return null;
  const { autoStartLocalDaemon } = value;
  if (typeof autoStartLocalDaemon !== "boolean") return null;
  return { autoStartLocalDaemon };
}

/** The view `{ currentId, entries, local, remote, settings, secretStore? }`, or `null` when it is not the expected shape. */
export function parseDaemonsView(value: unknown): DaemonsView | null {
  if (!isRecord(value)) return null;
  const { currentId, entries: rawEntries } = value;
  if (currentId !== null && typeof currentId !== "string") return null;
  if (!Array.isArray(rawEntries)) return null;
  const entries: DaemonEntryView[] = [];
  for (const raw of rawEntries) {
    const entry = parseEntryView(raw);
    if (!entry) return null;
    entries.push(entry);
  }
  const local = parseLocalState(value.local);
  const settings = parseSettings(value.settings);
  if (!local || !settings) return null;
  const remote = parseRemoteState(value.remote);
  // Any other value, and an absent field, are dropped: the page then says nothing.
  const { secretStore } = value;
  return secretStore === "keychain" || secretStore === "file"
    ? { currentId, entries, local, remote, settings, secretStore }
    : { currentId, entries, local, remote, settings };
}
