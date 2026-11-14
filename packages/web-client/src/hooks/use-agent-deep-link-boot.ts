import { useEffect } from "react";
import { useConnectionStore } from "@web-client/lib/connection/connection-store.js";
import { parseAgentDeepLink } from "@web-client/lib/agent-deep-link.js";
import { applyPendingAgentDeepLink } from "@web-client/features/sessions/apply-agent-deep-link.js";
import { useDeepLinkStore } from "@web-client/stores/deep-link-store.js";

/**
 * Reads `#agent=<id>` on mount and on `hashchange` into the pending-target store. Never connects;
 * the initial apply happens in `useSessionRestore` after restore settles. A `hashchange` on a page
 * that is already open and restored applies immediately.
 */
export function useAgentDeepLinkBoot(): void {
  useEffect(() => {
    const id = parseAgentDeepLink(window.location.hash);
    if (id) useDeepLinkStore.getState().set(id);

    function onHashChange(): void {
      const next = parseAgentDeepLink(window.location.hash);
      if (!next) return;
      useDeepLinkStore.getState().set(next);
      if (useConnectionStore.getState().status === "open" && useDeepLinkStore.getState().restored) {
        applyPendingAgentDeepLink();
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
}
