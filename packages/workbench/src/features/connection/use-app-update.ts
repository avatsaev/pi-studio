import { useEffect, useState } from "react";
import { getHost } from "../../host/install.js";
import { type AppUpdateState } from "../../host/types.js";

/**
 * The host's update state, re-read whenever it notifies; `null` when the host has no `updates`
 * (the browser), in which case no indicator is drawn.
 */
export function useAppUpdate(): AppUpdateState | null {
  const updates = getHost().updates;
  const [state, setState] = useState<AppUpdateState | null>(() => updates?.current() ?? null);

  useEffect(() => {
    if (!updates) return;
    // A change between the first render and the subscription would otherwise be missed.
    setState(updates.current());
    return updates.subscribe(() => setState(updates.current()));
  }, [updates]);

  return state;
}
