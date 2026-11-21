import { type HostConnection } from "@av-pi-studio/workbench";

import { type IpcEvents } from "./ipc.js";

/** The app's event that says the machine or the window came back. Its payload is not read. */
const RESUME_EVENT = "connection_resume";

/** The browser host's `connection`, whose `onResume` also hears the app's resume event. */
export function createDesktopConnection(
  base: HostConnection,
  events: IpcEvents,
  log: (message: string, error: unknown) => void,
): HostConnection {
  return {
    ...base,
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
      events
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
