/**
 * Viewer settings store — the single client-side answer to "is viewer X enabled?"
 * (docs/MOLVIEWER_DECOUPLING.md § 5 phase 0 step 1). Holds the daemon's `viewer_settings_*`
 * document, hydrated on connect and replaced wholesale by every `viewer_settings_update` push
 * (`use-viewer-settings.ts`'s `useViewerSettingsBoot`).
 *
 * This directory is new: phase 1 of the decoupling plan fills it with the plugin contract; the
 * store lands here first because it is the future plugin registry's enabled-filter, not a
 * generic app store — `swe/architecture/viewer-plugin-system.md` § Prerequisite reads it.
 *
 * Deliberately NOT `localStorage`-backed like `appearance-store.ts`: this state lives on the
 * daemon, and a second local copy would be a second source of truth that disagrees with the
 * daemon the first time a phone toggles a viewer.
 *
 * Two decisions this shape encodes:
 * - `isViewerEnabled(id) = viewers[id]?.enabled ?? true`. Absent row, an unhydrated store, and a
 *   capability-free daemon all mean *enabled* — the degrade direction always offers the viewer,
 *   never hides the user's file behind a daemon version.
 * - `loaded` is a real field, not derived from `Object.keys(viewers).length`: an empty document
 *   is a legitimate hydrated state, and the layout replay (task-005) waits on this flag.
 */

import { create } from "zustand";
import type { ViewerSettings, ViewerSettingsEntry } from "@av-pi-studio/protocol";
import type { ViewerSettingsPatch } from "@av-pi-studio/client";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";

export interface ViewerSettingsState {
  loaded: boolean;
  /** True iff the daemon advertised the `viewerSettings` capability. */
  capable: boolean;
  viewers: Record<string, ViewerSettingsEntry>;
  isViewerEnabled(id: string): boolean;
  /** Fetches the current document and replaces local state. Never issues an RPC against a
   *  capability-free daemon; sets `loaded: true` unconditionally (including on RPC failure) so
   *  the layout replay — gated on this flag — never wedges against a stale or unreachable
   *  daemon. */
  hydrate(): Promise<void>;
  /** Wholesale replace from a `viewer_settings_update` push. The daemon's document is
   *  authoritative — a merge here would resurrect a row another client deleted. */
  applyUpdate(settings: ViewerSettings): void;
  /** Optimistic: flips the row locally first, then reconciles with the daemon's effective
   *  document, rolling back to the EXACT prior value (including "no row at all") on rejection. */
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /** Same optimistic-then-reconcile posture as `setEnabled`, for the `config` field. */
  setConfig(id: string, config: Record<string, unknown>): Promise<void>;
  /** Back to the unhydrated state — called on disconnect so a stale document never survives past
   *  its daemon. */
  reset(): void;
}

const UNHYDRATED = { loaded: false, capable: false, viewers: {} } as const;

export const useViewerSettingsStore = create<ViewerSettingsState>()((set, get) => ({
  ...UNHYDRATED,

  isViewerEnabled(id) {
    return get().viewers[id]?.enabled ?? true;
  },

  async hydrate() {
    const client = useConnectionStore.getState().client;
    const capable = client?.hasViewerSettingsCapability() ?? false;
    if (!client || !capable) {
      set({ loaded: true, capable: false, viewers: {} });
      return;
    }
    try {
      const settings = await client.getViewerSettings();
      set({ loaded: true, capable: true, viewers: settings.viewers });
    } catch {
      // A failed fetch must not wedge tab restore: degrade to all-enabled. `capable` stays true —
      // the daemon DID advertise the feature; only this one fetch failed.
      set({ loaded: true, capable: true, viewers: {} });
    }
  },

  applyUpdate(settings) {
    set({ viewers: settings.viewers });
  },

  async setEnabled(id, enabled) {
    const client = useConnectionStore.getState().client;
    const previous = get().viewers[id];
    set((state) => ({ viewers: { ...state.viewers, [id]: { ...previous, enabled } } }));
    if (!client) return;
    try {
      const settings = await client.setViewerSettings({ [id]: { enabled } });
      set({ viewers: settings.viewers });
    } catch {
      rollback(set, id, previous);
    }
  },

  async setConfig(id, config) {
    const client = useConnectionStore.getState().client;
    const previous = get().viewers[id];
    set((state) => ({
      viewers: { ...state.viewers, [id]: { enabled: previous?.enabled ?? true, config } },
    }));
    if (!client) return;
    try {
      const settings = await client.setViewerSettings({ [id]: { config } });
      set({ viewers: settings.viewers });
    } catch {
      rollback(set, id, previous);
    }
  },

  reset() {
    set(UNHYDRATED);
  },
}));

/** Restores `id`'s row to `previous` — deleting it entirely when `previous` is `undefined`, so a
 *  rollback after patching a row that never existed never leaves a phantom `{ enabled: true }`
 *  behind. Shared by `setEnabled`/`setConfig`'s rejection paths. */
function rollback(
  set: (
    partial:
      | Partial<ViewerSettingsState>
      | ((state: ViewerSettingsState) => Partial<ViewerSettingsState>),
  ) => void,
  id: string,
  previous: ViewerSettingsEntry | undefined,
): void {
  set((state) => {
    const viewers = { ...state.viewers };
    if (previous === undefined) delete viewers[id];
    else viewers[id] = previous;
    return { viewers };
  });
}

/** Module-level read for non-React callers (e.g. `reopenClientTabs`'s injected predicate) that
 *  need a synchronous answer without a hook — the same value `useViewerSettingsStore((s) =>
 *  s.isViewerEnabled(id))` would give a component. */
export function isViewerEnabled(id: string): boolean {
  return useViewerSettingsStore.getState().isViewerEnabled(id);
}

/** Patch-entry type re-exported for convenience — the shape `setViewerSettings`/`setEnabled`/
 *  `setConfig` callers already reason in. */
export type { ViewerSettingsPatch };
