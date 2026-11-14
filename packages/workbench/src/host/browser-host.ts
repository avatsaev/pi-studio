import { localStorageKvStore } from "@av-pi-studio/ui-library";
import { copyText } from "./browser-clipboard.js";
import { createBrowserConnection } from "./browser-connection.js";
import { createBrowserFiles } from "./browser-files.js";
import { createBrowserLaunch } from "./browser-launch.js";
// Read at call time only (inside the files member), so the import cycle through the connection
// store is harmless.
import { currentFileTransfer } from "../lib/connection/live-file-transfer.js";
import { type AppIdentity, type HostDialogs, type HostPdf, type WorkbenchHost } from "./types.js";

export interface BrowserHostOptions {
  /** Brand title and version for the connection bar. A real shell always passes it. */
  app: AppIdentity;
  /**
   * The PDF runtime. Only the application bundle can build the pdf.js worker, so it passes it in
   * (`packages/web-client/src/main.tsx` shows the Vite form: a worker import of `pdfjs-dist`'s
   * `build/pdf.worker.min.mjs`, and the app base plus `pdfjs/`). Omitted: no PDF preview.
   */
  pdf: HostPdf;
}

const DEFAULT_APP: AppIdentity = { title: "Pi-Studio", version: "" };

/** The native blocking dialogs, wrapped in already-settled promises. */
const browserDialogs: HostDialogs = {
  confirm: async (message) => window.confirm(message),
  alert: async (message) => window.alert(message),
  prompt: async (message, initial) => window.prompt(message, initial),
};

/** The host `web-client` uses: today's browser behaviour behind the host contract. */
export function createBrowserHost(overrides: Partial<BrowserHostOptions> = {}): WorkbenchHost {
  return {
    app: overrides.app ?? DEFAULT_APP,
    storage: localStorageKvStore,
    clipboard: { writeText: copyText },
    dialogs: browserDialogs,
    // No `openExternal`: anchors keep their native `target="_blank"` behaviour.
    links: {},
    launch: createBrowserLaunch(),
    connection: createBrowserConnection(),
    // No `pickUploads`: the explorer uses its `<input type="file">`.
    files: createBrowserFiles(currentFileTransfer),
    ...(overrides.pdf ? { pdf: overrides.pdf } : {}),
  };
}
