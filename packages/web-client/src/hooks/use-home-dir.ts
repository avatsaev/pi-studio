/**
 * Resolves (and reactively exposes) the daemon's home directory, so `~`-relative session `cwd`s
 * can be normalized against their absolute form for workspace grouping (§4.3 sidebar tree).
 * Triggers `resolveHome` once the connection is fully open; re-renders the caller once it resolves.
 */

import { useEffect, useState } from "react";
import { useConnectionStore } from "../lib/connection/connection-store.js";
import { resolveHome, peekCachedHomeDir, onHomeDirResolved } from "../stores/explorer-store.js";

export function useHomeDir(): string | null {
  const client = useConnectionStore((s) => s.client);
  const status = useConnectionStore((s) => s.status);
  const [homeDir, setHomeDir] = useState<string | null>(peekCachedHomeDir());

  useEffect(() => onHomeDirResolved(setHomeDir), []);

  useEffect(() => {
    if (!client || status !== "open" || homeDir) return;
    void resolveHome(client);
  }, [client, status, homeDir]);

  return homeDir;
}
