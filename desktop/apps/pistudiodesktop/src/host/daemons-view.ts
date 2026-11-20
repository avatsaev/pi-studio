import { type DaemonEntryView, type DaemonSettings, type LocalDaemonState } from "@av-pi-studio/workbench";

/** The registry as the page holds it: what `HostDaemons.snapshot()` returns. No secret is in it. */
export interface DaemonsView {
  currentId: string | null;
  entries: DaemonEntryView[];
  local: LocalDaemonState;
  settings: DaemonSettings;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FAIL_REASONS = ["not_healthy", "timeout", "bad_output", "spawn_failed"] as const;
const ENTRY_KINDS = ["local", "direct", "relay"] as const;

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
      return { state: value.state };
    case "cli_missing": {
      const path = optionalString(value.path);
      if (path === null) return null;
      return path === undefined ? { state: "cli_missing" } : { state: "cli_missing", path };
    }
    case "cli_outdated":
      return typeof value.version === "string" ? { state: "cli_outdated", version: value.version } : null;
    case "running":
      return typeof value.host === "string" && typeof value.port === "number"
        ? { state: "running", host: value.host, port: value.port }
        : null;
    case "failed": {
      const reason = FAIL_REASONS.find((r) => r === value.reason);
      return reason ? { state: "failed", reason } : null;
    }
    default:
      return null;
  }
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
  return address === undefined
    ? { id: value.id, kind, name: value.name, hasPassword: value.hasPassword }
    : { id: value.id, kind, name: value.name, address, hasPassword: value.hasPassword };
}

function parseSettings(value: unknown): DaemonSettings | null {
  if (!isRecord(value)) return null;
  const { autoStartLocalDaemon, cliPath } = value;
  if (typeof autoStartLocalDaemon !== "boolean") return null;
  if (cliPath !== null && typeof cliPath !== "string") return null;
  return { autoStartLocalDaemon, cliPath };
}

/** The view `{ currentId, entries, local, settings }`, or `null` when it is not the expected shape. */
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
  return { currentId, entries, local, settings };
}
