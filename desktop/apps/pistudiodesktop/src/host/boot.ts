/** One file the engine could not read at start, reset and kept under another name. */
export interface FileResetNotice {
  kind: "file_reset";
  file: string;
  keptAs: string;
}

/** The answer of the `boot` command. */
export interface BootSnapshot {
  app: { title: string; version: string; platform: "desktop" };
  storage: Record<string, string>;
  notices: FileResetNotice[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotice(value: unknown): value is FileResetNotice {
  return (
    isRecord(value) &&
    value.kind === "file_reset" &&
    typeof value.file === "string" &&
    typeof value.keptAs === "string"
  );
}

/** The snapshot, or `null` when it is not the expected shape. */
export function parseBootSnapshot(value: unknown): BootSnapshot | null {
  if (!isRecord(value)) return null;
  const { app, storage, notices } = value;
  if (
    !isRecord(app) ||
    typeof app.title !== "string" ||
    typeof app.version !== "string" ||
    app.platform !== "desktop"
  ) {
    return null;
  }
  if (!isRecord(storage) || !Object.values(storage).every((v) => typeof v === "string")) {
    return null;
  }
  if (!Array.isArray(notices) || !notices.every(isNotice)) return null;
  return {
    app: { title: app.title, version: app.version, platform: "desktop" },
    storage: storage as Record<string, string>,
    notices,
  };
}

/** Calls `boot` and validates the answer. Rejects with a readable reason. */
export async function runBoot(ipcInvoke: (command: string) => Promise<unknown>): Promise<BootSnapshot> {
  const answer = await ipcInvoke("boot");
  const snapshot = parseBootSnapshot(answer);
  if (!snapshot) throw new Error("The app host answered boot with an unexpected shape.");
  return snapshot;
}

export function noticeText(notice: FileResetNotice): string {
  return `${notice.file} could not be read and was reset. The old file was kept as ${notice.keptAs}.`;
}

/** The text of a boot failure, whatever was thrown. */
export function errorReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error.";
}
