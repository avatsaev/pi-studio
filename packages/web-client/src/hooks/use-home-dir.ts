/**
 * Reactively exposes the daemon host's home directory, so `~`-relative session `cwd`s can be
 * normalized against their absolute form for workspace grouping (§4.3 sidebar tree) and the
 * workspace picker can seed itself somewhere that actually exists.
 *
 * The value is whatever the daemon reported in `server_info.homeDir` — never derived locally. It
 * used to be *probed* (list `/home`, take the first directory), which produced a nonexistent
 * `/home/<name>` against a macOS daemon whose real home is `/Users/<name>`.
 *
 * `null` means "not known yet / daemon predates the field"; every consumer treats that as "leave
 * tilde paths unexpanded" rather than guessing.
 */

import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";

export function useHomeDir(): string | null {
  return useConnectionStore((s) => s.serverInfo?.homeDir ?? null);
}
