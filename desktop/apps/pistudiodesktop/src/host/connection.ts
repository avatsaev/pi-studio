import { type HostConnection, type HostDaemons } from "@av-pi-studio/workbench";

import { type Ipc, type IpcEvents } from "./ipc.js";
import { createProxiedTransport } from "./proxied-transport.js";

/** The app's event that says the machine or the window came back. Its payload is not read. */
const RESUME_EVENT = "connection_resume";

/**
 * The browser host's `connection`, whose `onResume` also hears the app's resume event and whose
 * `createTransport` goes through Rust for a local or direct current entry (decision T1). The choice
 * follows the kind of the current entry, never the shape of the target: a relay entry whose pairing
 * link carries a direct host hint stays on the webview's own socket. With no current entry, the
 * browser host decides. `options.password` is ignored for a proxied entry: Rust reads the password
 * itself, so it is sent to no command.
 */
export function createDesktopConnection(
  base: HostConnection,
  ipc: Ipc & IpcEvents,
  daemons: Pick<HostDaemons, "snapshot">,
  log: (message: string, error: unknown) => void,
): HostConnection {
  return {
    ...base,
    createTransport(target, options) {
      const { currentId, entries } = daemons.snapshot();
      const kind = entries.find((entry) => entry.id === currentId)?.kind;
      if (kind === "local" || kind === "direct") return createProxiedTransport(ipc);
      return base.createTransport(target, options);
    },
    onResume(listener) {
      const call = (): void => {
        try {
          listener();
        } catch (error) {
          log("a resume listener threw", error);
        }
      };
      const stopBrowser = base.onResume(call);
      let stopped = false;
      let stopApp: (() => void) | undefined;
      ipc
        .listen(RESUME_EVENT, call)
        .then((stop) => {
          if (stopped) stop();
          else stopApp = stop;
        })
        .catch((error: unknown) => log("listening for connection_resume failed", error));
      return () => {
        stopped = true;
        stopBrowser();
        stopApp?.();
        stopApp = undefined;
      };
    },
  };
}
