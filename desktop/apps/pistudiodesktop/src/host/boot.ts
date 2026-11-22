import { isRecord, parseDaemonsView, type DaemonsView } from "./daemons-view.js";

/** One file the engine could not read at start, reset and kept under another name (`null`: it could not be renamed). */
export interface FileResetNotice {
  kind: "file_reset";
  file: string;
  keptAs: string | null;
}

/** A version 1 registry had secrets that the secret store would not take: they stay in the file. */
export interface SecretsNotMovedNotice {
  kind: "secrets_not_moved";
}

/** The keychain could not be used and no `--secret-store` was given: secrets are in `secrets.json`. `reason` is the store's code. */
export interface SecretStoreFallbackNotice {
  kind: "secret_store_fallback";
  reason: string;
}

/** Something the user is told once, at start. */
export type BootNotice = FileResetNotice | SecretsNotMovedNotice | SecretStoreFallbackNotice;

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
  if (value.kind === "secret_store_fallback") return typeof value.reason === "string";
  return (
    value.kind === "file_reset" &&
    typeof value.file === "string" &&
    (typeof value.keptAs === "string" || value.keptAs === null)
  );
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

/** Why the keychain was not used, by the store's code; any other code gets the general sentence. */
const FALLBACK_CAUSES: Record<string, string> = {
  unavailable: "No keychain could be reached",
  denied: "The keychain refused access (it may be locked)",
  failed: "The keychain did not work",
};

export function noticeText(notice: BootNotice): string {
  switch (notice.kind) {
    case "secrets_not_moved":
      return "Saved passwords could not be moved to the secret store. They still work for now and stay in the registry file; Pi Studio tries again at the next start.";
    case "secret_store_fallback": {
      // An own key only: `reason` comes off the wire, and "constructor" must not find a function.
      const cause = Object.hasOwn(FALLBACK_CAUSES, notice.reason) ? FALLBACK_CAUSES[notice.reason] : "The keychain could not be used";
      return `${cause}, so Pi Studio keeps saved passwords in secrets.json, a file only you can read.`;
    }
    case "file_reset":
      // `keptAs` is null when even the rename failed: the unreadable file is still where it was.
      return notice.keptAs === null
        ? `${notice.file} could not be read and was reset. The old file could not be renamed and is still in the folder.`
        : `${notice.file} could not be read and was reset. The old file was kept as ${notice.keptAs}.`;
  }
}

/** The text of a boot failure, whatever was thrown. */
export function errorReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error.";
}
