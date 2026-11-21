import { type WorkbenchHost } from "@av-pi-studio/workbench";

import { type Ipc } from "./ipc.js";

type Log = (message: string, error: unknown) => void;

/** Native confirm/alert: a failed call answers `false` (confirm) or just resolves (alert). */
export function createNativeDialogs(ipc: Ipc, log: Log): WorkbenchHost["dialogs"] {
  return {
    async confirm(message) {
      try {
        return (await ipc.invoke("dialog_confirm", { message })) === true;
      } catch (error) {
        log("dialog_confirm failed", error);
        return false;
      }
    },
    async alert(message) {
      try {
        await ipc.invoke("dialog_alert", { message });
      } catch (error) {
        log("dialog_alert failed", error);
      }
    },
  };
}

/** External links open in the system's default application; fire and forget. */
export function createNativeLinks(ipc: Ipc, log: Log): WorkbenchHost["links"] {
  return {
    openExternal(url) {
      ipc.invoke("open_external", { url }).catch((error: unknown) => log("open_external failed", error));
    },
  };
}
