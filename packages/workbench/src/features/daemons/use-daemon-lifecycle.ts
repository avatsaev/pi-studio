import { useEffect } from "react";
import { getHost } from "../../host/install.js";
import { type HostDaemons } from "../../host/types.js";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { watchDaemonLifecycle, type LifecycleEffects } from "./daemon-lifecycle.js";
import { useDaemonsStore } from "./daemons-store.js";

/** The real effects: the store's manual disconnect, the daemons store's marker and screen. */
function storeEffects(daemons: HostDaemons): LifecycleEffects {
  return {
    leave: () => useConnectionStore.getState().disconnect(),
    markLinkInvalid: (id) => useDaemonsStore.getState().markLinkInvalid(id),
    clearLinkInvalid: (id) => useDaemonsStore.getState().clearLinkInvalid(id),
    // A refused probe has nothing to add: the registry's own state change says what is wrong.
    refreshLocal: () => void daemons.local.refresh().catch(() => {}),
    connect: () => void useDaemonsStore.getState().connectCurrent(),
    openScreen: () => useDaemonsStore.getState().openScreen(),
  };
}

/** Mount once, inside the workbench shell. Does nothing when the host has no registry. */
export function useDaemonLifecycle(): void {
  const daemons = getHost().daemons;
  useEffect(
    () => (daemons ? watchDaemonLifecycle(daemons, storeEffects(daemons)) : undefined),
    [daemons],
  );
}
