import { useEffect, useState } from "react";
import { getHost } from "../../host/install.js";
import { type HostDaemons } from "../../host/types.js";

export type DaemonsSnapshot = ReturnType<HostDaemons["snapshot"]>;

/**
 * The host registry's current snapshot, re-read whenever it notifies; `null` when the host has no
 * registry (the browser), in which case nothing daemon-related is drawn.
 */
export function useDaemons(): DaemonsSnapshot | null {
  const daemons = getHost().daemons;
  const [snapshot, setSnapshot] = useState<DaemonsSnapshot | null>(
    () => daemons?.snapshot() ?? null,
  );

  useEffect(() => {
    if (!daemons) return;
    // A change between the first render and the subscription would otherwise be missed.
    setSnapshot(daemons.snapshot());
    return daemons.subscribe(() => setSnapshot(daemons.snapshot()));
  }, [daemons]);

  return snapshot;
}
