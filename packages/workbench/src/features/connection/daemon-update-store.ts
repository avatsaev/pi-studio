/**
 * The daemon's update status for the live connection (`swe/features/self-update.md` § Workbench).
 * Filled by `getDaemonUpdateStatus()` on every transition to connected and replaced wholesale by
 * every `daemon_update_status` broadcast (`use-daemon-update.ts`'s `useDaemonUpdateBoot`); cleared
 * when the connection leaves `open`, so a status never outlives its daemon. `null` means "nothing
 * to show": not connected, a daemon without the `daemonUpdate` capability (no request is sent to
 * it), or a fetch that failed.
 */

import { create } from "zustand";
import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";
import { useConnectionStore } from "../../lib/connection/connection-store.js";

export interface DaemonUpdateStoreState {
  status: DaemonUpdateStatus | null;
  /** Counts every `apply` and `reset`, so a fetch that was overtaken by a broadcast is dropped. */
  revision: number;
  /** Fetches the status once. Sends nothing to a daemon without the capability. */
  hydrate(): Promise<void>;
  /** Replaces the status from a broadcast or an RPC answer. */
  apply(status: DaemonUpdateStatus): void;
  /** Back to "nothing known" — called on disconnect. */
  reset(): void;
}

export const useDaemonUpdateStore = create<DaemonUpdateStoreState>()((set, get) => ({
  status: null,
  revision: 0,

  async hydrate() {
    const client = useConnectionStore.getState().client;
    if (!client?.hasDaemonUpdateCapability()) return;
    const revision = get().revision;
    try {
      const status = await client.getDaemonUpdateStatus();
      // A broadcast, a disconnect or another connection came in while the request was out: the
      // answer is older than what the store holds.
      if (get().revision !== revision || useConnectionStore.getState().client !== client) return;
      get().apply(status);
    } catch {
      // The pill stays hidden; the next broadcast or reconnect fills it.
    }
  },

  apply(status) {
    set((state) => ({ status, revision: state.revision + 1 }));
  },

  reset() {
    set((state) => ({ status: null, revision: state.revision + 1 }));
  },
}));
