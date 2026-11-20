import { type SaveTarget, type WorkbenchHost } from "@av-pi-studio/workbench";

import { type Ipc } from "./ipc.js";

/** Saves go through Rust: it shows the dialog and owns the file; the page holds only a handle. */
export function createSaveTarget(ipc: Ipc): (suggestedName: string) => Promise<SaveTarget | null> {
  return async (suggestedName) => {
    const started = await ipc.invoke("save_begin", { suggestedName });
    if (started === null || started === undefined) return null;
    const handle = (started as { handle?: unknown }).handle;
    if (typeof handle !== "string") throw new Error("save_begin: no handle");
    return {
      write: async (chunk) => void (await ipc.invoke("save_write", chunk, { headers: { handle } })),
      finish: async () => void (await ipc.invoke("save_finish", { handle })),
      discard: async () => void (await ipc.invoke("save_discard", { handle })),
    };
  };
}

/** `files` with `upload` and `saveToDisk` counted while they run; `report` gets each new count. */
export function countTransfers(
  files: WorkbenchHost["files"],
  report: (count: number) => void,
): WorkbenchHost["files"] {
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
