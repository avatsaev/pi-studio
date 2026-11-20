// The only module that imports `@tauri-apps/api` (`.oxlintrc.json` bans it elsewhere). Everything
// else takes an `Ipc`, so it can be tested with a fake.
import { invoke, isTauri } from "@tauri-apps/api/core";

/** The page's one channel to the Rust host: a command name and its arguments. */
export interface Ipc {
  invoke(
    command: string,
    args?: Record<string, unknown> | Uint8Array,
    options?: { headers: Record<string, string> },
  ): Promise<unknown>;
}

/** True inside the Tauri webview; false in the snapshot tool or a plain browser. */
export function tauriPresent(): boolean {
  return isTauri();
}

export const tauriIpc: Ipc = {
  invoke: (command, args, options) => invoke<unknown>(command, args, options),
};
