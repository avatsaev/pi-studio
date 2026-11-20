/**
 * Daemons UI store — in memory only. Whether the Daemons screen is open, the boot or action error
 * it shows, the relay entries marked "pairing link no longer valid" (spec decision P6: never
 * written to the registry file), and `connectCurrent`, the one action that boot, Retry and
 * "Reconnect now" share. The registry itself is `host.daemons`; this holds no copy of it.
 */

import { create } from "zustand";
import { getHost } from "../../host/install.js";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { connectCurrent } from "./connect-current.js";
import { type DaemonFailure } from "./daemon-presentation.js";

interface DaemonsStoreState {
  /** The Daemons screen is open. */
  open: boolean;
  /** The boot or action error the screen shows; `null` when there is none. */
  error: DaemonFailure | null;
  /** Ids of relay entries whose pairing link stopped working. */
  invalidLinks: ReadonlySet<string>;

  openScreen(): void;
  closeScreen(): void;
  setError(error: DaemonFailure | null): void;
  markLinkInvalid(id: string): void;
  clearLinkInvalid(id: string): void;
  /**
   * Ask the registry what to dial for the current entry and connect to it. A rejection dials
   * nothing, records its code in `error` and opens the screen (D18). No-op without `host.daemons`.
   */
  connectCurrent(): Promise<void>;
}

/** A `connectCurrent` is waiting for the host's answer. */
let resolving = false;

const INITIAL = { open: false, error: null, invalidLinks: new Set<string>() };

export const useDaemonsStore = create<DaemonsStoreState>()((set, get) => ({
  ...INITIAL,

  openScreen() {
    set({ open: true });
  },
  closeScreen() {
    set({ open: false });
  },
  setError(error) {
    set({ error });
  },
  markLinkInvalid(id) {
    if (get().invalidLinks.has(id)) return;
    set({ invalidLinks: new Set(get().invalidLinks).add(id) });
  },
  clearLinkInvalid(id) {
    if (!get().invalidLinks.has(id)) return;
    const next = new Set(get().invalidLinks);
    next.delete(id);
    set({ invalidLinks: next });
  },

  async connectCurrent() {
    const daemons = getHost().daemons;
    // Boot, Retry and the lifecycle's connect can overlap (a start from boot comes up while boot
    // is still resolving): one resolution at a time.
    if (!daemons || resolving) return;
    resolving = true;
    await connectCurrent(daemons, {
      // A failed connection is already held in the connection store; nothing to rethrow here.
      connect: (options) =>
        void useConnectionStore
          .getState()
          .connect(options)
          .catch(() => {}),
      resolved: () => set({ error: null }),
      rejected: (failure) => set({ error: failure, open: true }),
    }).finally(() => {
      resolving = false;
    });
  },
}));

/** Back to the initial state, for tests. */
export function resetDaemonsStoreForTests(): void {
  resolving = false;
  useDaemonsStore.setState({ ...INITIAL, invalidLinks: new Set() });
}
