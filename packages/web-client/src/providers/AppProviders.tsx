import { type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@pi-studio-ui/lib/connection/query-client.js";
import { ThemeBoundary } from "@pi-studio-ui/theme/ThemeBoundary.js";
import { localKvStore } from "./kv-store.js";

// Top-level provider composition. ThemeBoundary applies `--pi-*` CSS variables
// before first paint; TanStack Query owns server-cache state. Router and
// connection context are added as their phases land.
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeBoundary store={localKvStore}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeBoundary>
  );
}
