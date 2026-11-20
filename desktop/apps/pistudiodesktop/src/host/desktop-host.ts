import { createBrowserHost, type BrowserHostOptions, type WorkbenchHost } from "@av-pi-studio/workbench";

import { type BootSnapshot } from "./boot.js";
import { type Ipc } from "./ipc.js";
import { createSaveTarget, countTransfers } from "./transfers.js";
import { createNativeDialogs, createNativeLinks } from "./native.js";
import { createDesktopStorage } from "./storage.js";

/** A launch with no connect intent and no deep-link source. */
const NO_LAUNCH: WorkbenchHost["launch"] = {
  initialConnect: () => null,
  agentDeepLink: { current: () => null, subscribe: () => () => undefined, consume: () => undefined },
};

/** The browser host with `app`, `storage` and `launch` replaced by the desktop's. */
export function createDesktopHost(
  snapshot: BootSnapshot,
  ipc: Ipc,
  pdf: BrowserHostOptions["pdf"],
): WorkbenchHost {
  const log = (message: string, error: unknown): void => console.error(message, error);
  const storage = createDesktopStorage(
    snapshot.storage,
    (key, value) => ipc.invoke("storage_set", { key, value }),
    log,
  );
  const base = createBrowserHost({ app: snapshot.app, pdf, saveTarget: createSaveTarget(ipc) });
  return {
    ...base,
    files: countTransfers(base.files, (count) => {
      ipc.invoke("transfers_set", { count }).catch((error: unknown) => log("transfers_set failed", error));
    }),
    storage,
    dialogs: createNativeDialogs(ipc, log),
    links: createNativeLinks(ipc, log),
    launch: NO_LAUNCH,
  };
}
