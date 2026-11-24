/**
 * The daemon's update status for the live connection (`swe/features/self-update.md` § Workbench).
 * Filled by `getDaemonUpdateStatus()` on every transition to connected and replaced wholesale by
 * every `daemon_update_status` broadcast (`use-daemon-update.ts`'s `useDaemonUpdateBoot`); cleared
 * when the connection leaves `open`, so a status never outlives its daemon. `null` means "nothing
 * to show": not connected, a daemon without the `daemonUpdate` capability (no request is sent to
 * it), or a fetch that failed.
 *
 * One thing outlives the disconnect on purpose: that the daemon announced `restarting`
 * (`restartAnnouncedAt`). The socket drops a moment later, and the window must not take that drop
 * for a daemon that stopped (`daemon-lifecycle.ts`): this one comes back by itself.
 */

import { create } from "zustand";
import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";
import { useConnectionStore } from "../../lib/connection/connection-store.js";

/**
 * How long an announced restart excuses a dropped connection. The update helper's own limits (a
 * 30 s wait for the old process, three 6 s starts, a 120 s rollback install, three more starts)
 * add up to less than this.
 */
export const RESTART_EXCUSE_MS = 240_000;

/** Whether a restart announced at `announcedAt` (epoch ms) still explains a dropped connection at `now`. */
export function isRestartExpected(announcedAt: number | null, now: number): boolean {
  return announcedAt !== null && now - announcedAt < RESTART_EXCUSE_MS;
}

export interface DaemonUpdateStoreState {
  status: DaemonUpdateStatus | null;
  /** Counts every `apply` and `reset`, so a fetch that was overtaken by a broadcast is dropped. */
  revision: number;
  /** When the last status said `restarting`, until a later status says anything else; kept by `reset`. */
  restartAnnouncedAt: number | null;
  /** Fetches the status once. Sends nothing to a daemon without the capability. */
  hydrate(): Promise<void>;
  /** Replaces the status from a broadcast or an RPC answer. */
  apply(status: DaemonUpdateStatus): void;
  /** Back to "nothing known" — called on disconnect. An announced restart is remembered. */
  reset(): void;
}

export const useDaemonUpdateStore = create<DaemonUpdateStoreState>()((set, get) => ({
  status: null,
  revision: 0,
  restartAnnouncedAt: null,

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
    set((state) => ({
      status,
      revision: state.revision + 1,
      restartAnnouncedAt: status.state.kind === "restarting" ? Date.now() : null,
    }));
  },

  reset() {
    set((state) => ({ status: null, revision: state.revision + 1 }));
  },
}));
