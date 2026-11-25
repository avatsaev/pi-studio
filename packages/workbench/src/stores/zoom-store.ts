/**
 * The window's zoom level (Settings → Appearance, Ctrl/Cmd + = / − / 0). The workbench owns the
 * level and stores it in the host's storage; the host applies it as native page zoom
 * (`WorkbenchHost.zoom`). A host without `zoom` (the browser) keeps its own zoom: nothing here
 * runs there except reading the stored value.
 */

import { create } from "zustand";
import { getHost, onHostInstalled } from "../host/install.js";

export const ZOOM_STORAGE_KEY = "pi-studio-zoom";

/** The levels zoom steps through, a browser's ladder trimmed to the useful range. */
export const ZOOM_LEVELS: readonly number[] = [
  0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2,
];

/** The stored value as a ladder level: the nearest one, or 1 when it is missing or unreadable. */
export function parseZoom(raw: string | null): number {
  const value = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return ZOOM_LEVELS.reduce((best, level) =>
    Math.abs(level - value) < Math.abs(best - value) ? level : best,
  );
}

/** The next level up (`1`) or down (`-1`) from `current`, held at the ladder's ends. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_LEVELS.find((level) => level > current + 1e-9) ?? current;
  return ZOOM_LEVELS.findLast((level) => level < current - 1e-9) ?? current;
}

export type ZoomAction = "in" | "out" | "reset";

/** The zoom shortcut a key press is, if any: Ctrl/Cmd with = or +, − or _, or 0 (keypad too). */
export function zoomShortcut(
  ev: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey">,
): ZoomAction | null {
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return null;
  if (ev.key === "=" || ev.key === "+" || ev.code === "NumpadAdd") return "in";
  if (ev.key === "-" || ev.key === "_" || ev.code === "NumpadSubtract") return "out";
  if (ev.key === "0" || ev.code === "Numpad0") return "reset";
  return null;
}

interface ZoomState {
  factor: number;
  setFactor(factor: number): void;
  apply(action: ZoomAction): void;
}

export const useZoomStore = create<ZoomState>()((set, get) => ({
  factor: parseZoom(getHost().storage.get(ZOOM_STORAGE_KEY)),
  setFactor(factor) {
    const next = parseZoom(String(factor));
    if (next === get().factor) return;
    set({ factor: next });
    const host = getHost();
    host.storage.set(ZOOM_STORAGE_KEY, String(next));
    host.zoom?.set(next);
  },
  apply(action) {
    const { factor, setFactor } = get();
    setFactor(action === "reset" ? 1 : stepZoom(factor, action === "in" ? 1 : -1));
  },
}));

// The level was read at module load, from the fallback host. Re-read it from the host the shell
// installs, and apply it there: a webview starts at 100% on every launch.
onHostInstalled((host) => {
  const factor = parseZoom(host.storage.get(ZOOM_STORAGE_KEY));
  useZoomStore.setState({ factor });
  if (factor !== 1) host.zoom?.set(factor);
});
