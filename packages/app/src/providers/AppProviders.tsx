/**
 * AppProviders — the root React provider tree.
 * Wraps children with: QueryClient, ThemeBoundary, ConnectionProvider, UI stores.
 */

import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeBoundary } from "../theme/ThemeBoundary.js";
import { TooltipProvider } from "../components/overlays/Tooltip.js";
import { createWebKVStore, type KeyValueStore } from "./kv-store.js";
import { type BrandConfig } from "../brand/config.js";
import { ConnectionProvider } from "./ConnectionProvider.js";

// A stable QueryClient instance (created once per app lifecycle)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
    },
  },
});

// Default KV store for the web target
const defaultKVStore = createWebKVStore();

export interface AppProvidersProps {
  children: ReactNode;
  kvStore?: KeyValueStore;
  brandConfig?: BrandConfig;
  /** When true, skip the ConnectionProvider (useful for storybook/testing). */
  skipConnection?: boolean;
}

/**
 * Wraps the entire app in the required provider hierarchy:
 * QueryClient → ThemeBoundary → ConnectionProvider (daemon) → children.
 */
export function AppProviders({
  children,
  kvStore = defaultKVStore,
  brandConfig,
  skipConnection = false,
}: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeBoundary store={kvStore} brandConfig={brandConfig}>
        <TooltipProvider>
          {skipConnection ? (
            children
          ) : (
            <ConnectionProvider kvStore={kvStore}>
              {children}
            </ConnectionProvider>
          )}
        </TooltipProvider>
      </ThemeBoundary>
    </QueryClientProvider>
  );
}
