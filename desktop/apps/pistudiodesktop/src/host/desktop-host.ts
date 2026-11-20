import { createBrowserHost, type BrowserHostOptions, type WorkbenchHost } from "@av-pi-studio/workbench";

import { type BootSnapshot } from "./boot.js";
import { type Ipc } from "./ipc.js";
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
  const storage = createDesktopStorage(
    snapshot.storage,
    (key, value) => ipc.invoke("storage_set", { key, value }),
    (message, error) => console.error(message, error),
  );
  return {
    ...createBrowserHost({ app: snapshot.app, pdf }),
    storage,
    launch: NO_LAUNCH,
  };
}
