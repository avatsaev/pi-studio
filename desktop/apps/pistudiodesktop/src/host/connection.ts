import { type HostConnection, type HostDaemons } from "@av-pi-studio/workbench";

import { type Ipc, type IpcEvents } from "./ipc.js";
import { createProxiedTransport } from "./proxied-transport.js";

/** The app's event that says the machine or the window came back. Its payload is not read. */
const RESUME_EVENT = "connection_resume";

/**
 * The browser host's `connection`, whose `onResume` also hears the app's resume event and whose
 * `createTransport` goes through Rust for every kind of current entry (decisions D4, T1): the page
 * opens no relay or daemon socket of its own, and a relay refusal comes back as a
 * `RelayConnectError`. With no current entry, the browser host decides. `options.password` is
 * ignored: Rust reads the secret itself, so it is sent to no command.
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
      if (kind === undefined) return base.createTransport(target, options);
      return createProxiedTransport(ipc, undefined, kind === "relay");
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
