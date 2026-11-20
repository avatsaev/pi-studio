// The only module that imports `@tauri-apps/api` (`.oxlintrc.json` bans it elsewhere). Everything
// else takes an `Ipc`, so it can be tested with a fake.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** The page's one channel to the Rust host: a command name and its arguments. */
export interface Ipc {
  invoke(
    command: string,
    args?: Record<string, unknown> | Uint8Array,
    options?: { headers: Record<string, string> },
  ): Promise<unknown>;
}

/** The events the app emits to the page (`daemons_changed`, `daemons_manage`). */
export interface IpcEvents {
  /** Calls `handler` with each payload of `event`. Resolves, with the way to stop listening, once registered. */
  listen(event: string, handler: (payload: unknown) => void): Promise<() => void>;
}

/** True inside the Tauri webview; false in the snapshot tool or a plain browser. */
export function tauriPresent(): boolean {
  return isTauri();
}

export const tauriIpc: Ipc & IpcEvents = {
  invoke: (command, args, options) => invoke<unknown>(command, args, options),
  listen: (event, handler) => listen<unknown>(event, (message) => handler(message.payload)),
};
