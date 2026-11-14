/**
 * Applies the pending `#agent=` deep link against the real stores. Selection is exactly a sidebar
 * click (`SessionList.handleSelect`): activate + setCwd + open the chat tab in the focused pane.
 */

import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { applyAgentDeepLink, stripAgentParam } from "@pi-studio-ui/lib/agent-deep-link.js";
import { useDeepLinkStore } from "@pi-studio-ui/stores/deep-link-store.js";
import { useSessionStore, type SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { useToastStore } from "@pi-studio-ui/stores/toast-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { openChatTab } from "./open-chat-tab.js";

export function applyPendingAgentDeepLink(): void {
  applyAgentDeepLink<SessionEntry>({
    consume: () => useDeepLinkStore.getState().consume(),
    findByAgentId: (agentId) => useSessionStore.getState().findByAgentId(agentId),
    select(session) {
      useSessionStore.getState().activate(session.id);
      if (session.cwd) useUiStore.getState().setCwd(session.cwd);
      openChatTab(session, useConnectionStore.getState().serverInfo?.homeDir ?? null);
    },
    notifyNotFound(agentId) {
      useToastStore.getState().show(`Agent not found: ${agentId}`, { variant: "warning" });
    },
    replaceUrl() {
      window.history.replaceState(null, "", stripAgentParam(window.location.href));
    },
  });
}
