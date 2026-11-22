import {
  type SaveTarget,
  type TransferOptions,
  type TransferState,
  type UploadSource,
  type WorkbenchHost,
} from "@av-pi-studio/workbench";

import { type BootSnapshot } from "./boot.js";
import { isRecord } from "./daemons-view.js";
import { type Ipc, type IpcEvents } from "./ipc.js";

/** Shows the save dialog. The save's handle, or `null` when the user cancelled. */
async function beginSave(ipc: Ipc, suggestedName: string): Promise<string | null> {
  const started = await ipc.invoke("save_begin", { suggestedName });
  if (started === null || started === undefined) return null;
  const handle = (started as { handle?: unknown }).handle;
  if (typeof handle !== "string") throw new Error("save_begin: no handle");
  return handle;
}

/** Saves go through Rust: it shows the dialog and owns the file; the page holds only a handle. */
export function createSaveTarget(ipc: Ipc): (suggestedName: string) => Promise<SaveTarget | null> {
  return async (suggestedName) => {
    const handle = await beginSave(ipc, suggestedName);
    if (handle === null) return null;
    return {
      write: async (chunk) => void (await ipc.invoke("save_write", chunk, { headers: { handle } })),
      finish: async () => void (await ipc.invoke("save_finish", { handle })),
      discard: async () => void (await ipc.invoke("save_discard", { handle })),
    };
  };
}

/** `files` with `upload` and `saveToDisk` counted while they run; `report` gets each new count. */
export function countTransfers(files: WorkbenchHost["files"], report: (count: number) => void): WorkbenchHost["files"] {
  let running = 0;
  const track = async <T>(work: () => Promise<T>): Promise<T> => {
    report(++running);
    try {
      return await work();
    } finally {
      report(--running);
    }
  };
  return {
    ...files,
    upload: (...args) => track(() => files.upload(...args)),
    saveToDisk: (...args) => track(() => files.saveToDisk(...args)),
  };
}

/** True when the engine does the file transfers: `--transfers engine` and a current entry that is `local` or `direct`. */
export function engineServes(snapshot: BootSnapshot): boolean {
  if (snapshot.transfers !== "engine") return false;
  const current = snapshot.daemons.entries.find((entry) => entry.id === snapshot.daemons.currentId);
  return current?.kind === "local" || current?.kind === "direct";
}

/** The handle of each picked source. A `WeakMap`, so the source the workbench holds shows no handle. */
const pickedHandles = new WeakMap<object, string>();

const TRANSFER_STATES: readonly TransferState[] = ["queued", "running", "waiting"];

/** What a transfer command rejects with: an `AbortError` for the engine's `cancelled`, else an `Error` with its message. */
function transferFailure(error: unknown): Error {
  if (isRecord(error) && typeof error.message === "string") {
    return error.code === "cancelled" ? new DOMException(error.message, "AbortError") : new Error(error.message);
  }
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : "The transfer failed.");
}

function abortError(): DOMException {
  return new DOMException("The transfer was aborted", "AbortError");
}

function parsePicked(answer: unknown): UploadSource[] {
  if (!Array.isArray(answer)) throw new Error("upload_pick: not a list");
  return answer.map((item: unknown) => {
    if (!isRecord(item) || typeof item.handle !== "string" || typeof item.name !== "string") {
      throw new Error("upload_pick: unexpected item");
    }
    const source: UploadSource =
      typeof item.size === "number" ? { name: item.name, size: item.size } : { name: item.name };
    pickedHandles.set(source, item.handle);
    return source;
  });
}

/**
 * `base` with the engine's `pickUploads`, `upload` of a picked source and `saveToDisk`. A `Blob`
 * still goes to `base.upload`. One `transfer_progress` listener serves every transfer of the host.
 */
export function createEngineFiles(
  base: WorkbenchHost["files"],
  ipc: Ipc & IpcEvents,
  log: (message: string, error: unknown) => void,
): WorkbenchHost["files"] {
  const running = new Map<string, (payload: Record<string, unknown>) => void>();
  const listening = ipc.listen("transfer_progress", (payload) => {
    if (isRecord(payload) && typeof payload.id === "string") running.get(payload.id)?.(payload);
  });
  listening.catch((error: unknown) => log("listening for transfer_progress failed", error));

  /** Runs one engine transfer: progress events by `id` to the options, an abort to `transfer_cancel`, the answer or error to the result. */
  const run = async (
    command: "transfer_upload" | "transfer_save",
    handle: string,
    path: string,
    options?: TransferOptions,
  ): Promise<void> => {
    await listening;
    if (options?.signal?.aborted) throw abortError();
    const id = crypto.randomUUID();
    let state: TransferState | undefined;
    running.set(id, (event) => {
      const next = TRANSFER_STATES.find((known) => known === event.state);
      if (next === undefined) return;
      if (next !== state) options?.onStateChange?.((state = next));
      if (next === "running" && typeof event.done === "number") {
        options?.onProgress?.(event.done, typeof event.total === "number" ? event.total : undefined);
      }
    });
    const signal = options?.signal;
    const cancel = (): void => {
      ipc.invoke("transfer_cancel", { id }).catch((error: unknown) => log("transfer_cancel failed", error));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      await ipc.invoke(command, { id, handle, path });
    } catch (error) {
      throw transferFailure(error);
    } finally {
      signal?.removeEventListener("abort", cancel);
      running.delete(id);
    }
  };

  return {
    ...base,
    pickUploads: async () => parsePicked(await ipc.invoke("upload_pick")),
    upload: async (dir, source, options) => {
      const handle = pickedHandles.get(source);
      if (handle === undefined) return base.upload(dir, source, options);
      if (options?.signal?.aborted) throw abortError();
      await run("transfer_upload", handle, dir ? `${dir}/${source.name}` : source.name, options);
    },
    saveToDisk: async (path, options) => {
      if (options?.signal?.aborted) throw abortError();
      const handle = await beginSave(ipc, path.split("/").pop() || "download");
      if (handle === null) return;
      if (options?.signal?.aborted) {
        await ipc.invoke("save_discard", { handle }).catch((error: unknown) => log("save_discard failed", error));
        throw abortError();
      }
      await run("transfer_save", handle, path, options);
    },
  };
}
