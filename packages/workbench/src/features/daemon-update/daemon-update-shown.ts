/**
 * Which update result this client has already shown, per daemon (`serverId`), kept in the host's
 * storage so a reload does not show it again. A result is unseen when its `at` is newer than the
 * stored marker; no marker means unseen. A malformed record reads as empty.
 */

import type { KeyValueStore } from "@av-pi-studio/ui-library";
import type { DaemonUpdateResult } from "./daemon-update-dialog-view.js";

export const SHOWN_RESULT_KEY = "pi-studio-daemon-update-shown";

function readAll(store: KeyValueStore): Record<string, number> {
  const raw = store.get(SHOWN_RESULT_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const markers: Record<string, number> = {};
    for (const [serverId, at] of Object.entries(parsed)) {
      if (typeof at === "number") markers[serverId] = at;
    }
    return markers;
  } catch {
    return {};
  }
}

export function readShownMarker(store: KeyValueStore, serverId: string): number | undefined {
  return readAll(store)[serverId];
}

export function writeShownMarker(store: KeyValueStore, serverId: string, at: number): void {
  store.set(SHOWN_RESULT_KEY, JSON.stringify({ ...readAll(store), [serverId]: at }));
}

export function isUnseenResult(
  result: DaemonUpdateResult | undefined,
  marker: number | undefined,
): result is DaemonUpdateResult {
  return result !== undefined && (marker === undefined || result.at > marker);
}
