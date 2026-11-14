/**
 * Pending agent deep-link target (swe/features/web-ui-agent-deep-link.md). In memory only, never
 * persisted. `restored` flips once the initial session restore has settled, which is when a pending
 * target may first be applied.
 */

import { create } from "zustand";

interface DeepLinkState {
  pendingAgentId: string | undefined;
  restored: boolean;
  set(agentId: string): void;
  consume(): string | undefined;
  markRestored(): void;
}

export const useDeepLinkStore = create<DeepLinkState>((set, get) => ({
  pendingAgentId: undefined,
  restored: false,
  set(agentId) {
    set({ pendingAgentId: agentId });
  },
  consume() {
    const id = get().pendingAgentId;
    set({ pendingAgentId: undefined });
    return id;
  },
  markRestored() {
    set({ restored: true });
  },
}));
