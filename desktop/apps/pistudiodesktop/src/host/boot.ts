import { isRecord, parseDaemonsView, type DaemonsView } from "./daemons-view.js";

/** One file the engine could not read at start, reset and kept under another name. */
export interface FileResetNotice {
  kind: "file_reset";
  file: string;
  keptAs: string;
}

/** A version 1 registry had secrets that the secret store would not take: they stay in the file. */
export interface SecretsNotMovedNotice {
  kind: "secrets_not_moved";
}

/** Something the user is told once, at start. */
export type BootNotice = FileResetNotice | SecretsNotMovedNotice;

/** The answer of the `boot` command. */
export interface BootSnapshot {
  /** `minDaemonVersion` is the oldest daemon the app expects (`AppIdentity` of the workbench). */
  app: { title: string; version: string; platform: "desktop"; minDaemonVersion: string };
  storage: Record<string, string>;
  notices: BootNotice[];
  /** Whether the HTML viewer can load from the preview origin on this platform. */
  preview: "origin" | "inert";
  /** The daemon registry at boot: entries, the current one, the local daemon's state, settings. */
  daemons: DaemonsView;
}

function isNotice(value: unknown): value is BootNotice {
  if (!isRecord(value)) return false;
  if (value.kind === "secrets_not_moved") return true;
  return value.kind === "file_reset" && typeof value.file === "string" && typeof value.keptAs === "string";
}

/** The snapshot, or `null` when it is not the expected shape. */
export function parseBootSnapshot(value: unknown): BootSnapshot | null {
  if (!isRecord(value)) return null;
  const { app, storage, notices, preview } = value;
  if (
    !isRecord(app) ||
    typeof app.title !== "string" ||
    typeof app.version !== "string" ||
    app.platform !== "desktop" ||
    typeof app.minDaemonVersion !== "string" ||
    app.minDaemonVersion === ""
  ) {
    return null;
  }
  if (!isRecord(storage) || !Object.values(storage).every((v) => typeof v === "string")) {
    return null;
  }
  if (!Array.isArray(notices) || !notices.every(isNotice)) return null;
  if (preview !== "origin" && preview !== "inert") return null;
  const daemons = parseDaemonsView(value.daemons);
  if (!daemons) return null;
  return {
    app: { title: app.title, version: app.version, platform: "desktop", minDaemonVersion: app.minDaemonVersion },
    storage: storage as Record<string, string>,
    notices,
    preview,
    daemons,
  };
}

/** Calls `boot` and validates the answer. Rejects with a readable reason. */
export async function runBoot(ipcInvoke: (command: string) => Promise<unknown>): Promise<BootSnapshot> {
  const answer = await ipcInvoke("boot");
  const snapshot = parseBootSnapshot(answer);
  if (!snapshot) throw new Error("The app host answered boot with an unexpected shape.");
  return snapshot;
}

export function noticeText(notice: BootNotice): string {
  if (notice.kind === "secrets_not_moved") {
    return "Saved passwords could not be moved to the secret store. They still work for now and stay in the registry file; Pi Studio tries again at the next start.";
  }
  return `${notice.file} could not be read and was reset. The old file was kept as ${notice.keptAs}.`;
}

/** The text of a boot failure, whatever was thrown. */
export function errorReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error.";
}
