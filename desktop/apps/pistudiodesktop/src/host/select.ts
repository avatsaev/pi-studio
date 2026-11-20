export type HostKind = "desktop" | "browser";

/** Chosen once at start: the Tauri webview gets the desktop host, any other page the browser host. */
export function selectHostKind(tauriPresent: boolean): HostKind {
  return tauriPresent ? "desktop" : "browser";
}
