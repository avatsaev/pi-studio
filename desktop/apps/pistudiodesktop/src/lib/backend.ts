import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { Backend, Reply, View } from "./types";

declare global {
  interface Window {
    /** A fixed view to draw when there is no app behind the page (`npm run snapshot`). */
    __PISTUDIODESKTOP_VIEW__?: View;
  }
}

const failed = (error: unknown): Reply => ({ ok: false, error: String(error) });

/** The running desktop app: two Tauri commands and one event (`src-tauri/src/bridge.rs`). */
export function tauriBackend(): Backend {
  return {
    control: (method, params) => invoke<Reply>("control", { method, params: params ?? null }).catch(failed),
    invoke: (command) => invoke<Reply>("invoke_command", { command }).catch(failed),
    onView: (draw) => listen<View>("view", (event) => draw(event.payload)),
  };
}

/** A fixed view and no engine: the page draws, and every action is refused. */
export function staticBackend(view: View | null): Backend {
  const refused: Reply = { ok: false, error: "there is no app behind this page" };
  return {
    control: async (method) => (method === "ui.inspect" && view ? { ok: true, result: view } : refused),
    invoke: async () => refused,
    onView: async () => () => {},
  };
}

export function connect(): Backend {
  return isTauri() ? tauriBackend() : staticBackend(window.__PISTUDIODESKTOP_VIEW__ ?? null);
}
