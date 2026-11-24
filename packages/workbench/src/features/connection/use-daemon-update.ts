import { useEffect } from "react";
import type { ConnectionState, PiStudioClient } from "@av-pi-studio/client";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { useDaemonUpdateStore } from "./daemon-update-store.js";

/**
 * Binds `daemon-update-store.ts` to one connection state. Not open, or a daemon without the
 * `daemonUpdate` capability: the store is cleared and nothing is sent. Open: follows the
 * `daemon_update_status` broadcast and asks for the status; the subscription is made first, so a
 * broadcast between the two is not missed (the store drops an answer a broadcast overtook).
 * Returns the unsubscribe.
 */
export function bindDaemonUpdate(
  status: ConnectionState,
  client: PiStudioClient | null,
): (() => void) | undefined {
  const store = useDaemonUpdateStore.getState();
  if (status !== "open" || !client || !client.hasDaemonUpdateCapability()) {
    store.reset();
    return undefined;
  }
  const unsubscribe = client.onDaemonUpdateStatus((next) => {
    useDaemonUpdateStore.getState().apply(next);
  });
  void store.hydrate();
  return unsubscribe;
}

/**
 * Connection-scoped boot of the store: runs `bindDaemonUpdate` on every transition to connected
 * and clears the store when the connection leaves `open`. Mount once, in `WorkbenchBoot`.
 */
export function useDaemonUpdateBoot(): void {
  const status = useConnectionStore((s) => s.status);
  const client = useConnectionStore((s) => s.client);

  useEffect(() => bindDaemonUpdate(status, client), [status, client]);
}
