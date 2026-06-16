/**
 * Stores client capabilities keyed by `clientId` so they can be rehydrated when the same client
 * reconnects (architecture/websocket-protocol.md § Behavior). Default implementation is in-memory
 * for the daemon process lifetime; a persistent implementation can be swapped in later.
 */
export interface CapabilityStore {
  get(clientId: string): Record<string, boolean> | undefined;
  set(clientId: string, capabilities: Record<string, boolean>): void;
}

export function createInMemoryCapabilityStore(): CapabilityStore {
  const map = new Map<string, Record<string, boolean>>();
  return {
    get: (clientId) => map.get(clientId),
    set: (clientId, capabilities) => {
      map.set(clientId, capabilities);
    },
  };
}
