/**
 * ClientContext — React context providing the PiStudioClient instance.
 *
 * Injected by AppProviders; consumed by all query/mutation hooks via useClient().
 * See: clean-room-scope/architecture/client-app-runtime.md § connection provider
 */

import { createContext, useContext, type ReactNode } from "react";
import type { PiStudioClient } from "@av-pi-studio/client";

const ClientContext = createContext<PiStudioClient | null>(null);

export interface ClientProviderProps {
  client: PiStudioClient | null;
  children: ReactNode;
}

export function ClientProvider({ client, children }: ClientProviderProps) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

/** Returns the PiStudioClient, or null if not yet connected. */
export function useClient(): PiStudioClient | null {
  return useContext(ClientContext);
}
