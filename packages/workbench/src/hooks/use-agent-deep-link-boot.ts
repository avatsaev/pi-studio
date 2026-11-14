import { useEffect } from "react";
import { getHost } from "../host/install.js";
import { type AgentDeepLinkSource } from "../host/types.js";
import { useConnectionStore } from "../lib/connection/connection-store.js";
import { applyPendingAgentDeepLink } from "../features/sessions/apply-agent-deep-link.js";
import { useDeepLinkStore } from "../stores/deep-link-store.js";

/**
 * Reads the pending agent deep link at boot and every later request into the pending-target store.
 * Never connects; the initial apply happens in `useSessionRestore` after restore settles. A request
 * that arrives while the app is open and restored applies immediately. Returns the unsubscribe.
 */
export function startAgentDeepLinkBoot(
  source: AgentDeepLinkSource,
  apply: () => void = applyPendingAgentDeepLink,
): () => void {
  const id = source.current();
  if (id) useDeepLinkStore.getState().set(id);
  return source.subscribe((next) => {
    useDeepLinkStore.getState().set(next);
    if (useConnectionStore.getState().status === "open" && useDeepLinkStore.getState().restored) {
      apply();
    }
  });
}

export function useAgentDeepLinkBoot(): void {
  useEffect(() => startAgentDeepLinkBoot(getHost().launch.agentDeepLink), []);
}
