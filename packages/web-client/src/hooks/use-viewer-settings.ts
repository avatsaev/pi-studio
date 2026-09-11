/**
 * Viewer-settings boot: hydrates `viewer-settings-store.ts` on connect, subscribes to
 * `viewer_settings_update` pushes for the lifetime of the connection, and resets local state
 * whenever the connection leaves `open` — so a stale document never survives past its daemon and a
 * subsequent reconnect always re-hydrates.
 *
 * Subscribing directly inside this effect (rather than from a component) means exactly one
 * subscription exists per connection, matching `viewer-settings-store.ts`'s own note ("not per
 * component") and `use-terminal-exit-watch.ts`'s established shape for a connection-scoped push
 * subscription.
 *
 * Mount once in `app.tsx`'s `Boot`, after `useConnectionBoot()` and before `usePaneLayoutBoot()`.
 * Ordering is not load-bearing — the layout replay gates on the store's `loaded` flag, not hook
 * declaration order — but it keeps the read order legible.
 */

import { useEffect } from "react";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useViewerSettingsStore } from "@pi-studio-ui/viewer-plugins/viewer-settings-store.js";

export function useViewerSettingsBoot(): void {
  const status = useConnectionStore((s) => s.status);
  const client = useConnectionStore((s) => s.client);

  useEffect(() => {
    if (status !== "open" || !client) {
      useViewerSettingsStore.getState().reset();
      return;
    }
    void useViewerSettingsStore.getState().hydrate();
    return client.onViewerSettingsUpdate((settings) => {
      useViewerSettingsStore.getState().applyUpdate(settings);
    });
  }, [status, client]);
}
