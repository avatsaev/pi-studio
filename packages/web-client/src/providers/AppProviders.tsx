import { type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@web-client/lib/connection/query-client.js";
import { ThemeBoundary } from "@av-pi-studio/ui-library";

// Top-level provider composition. ThemeBoundary applies `--pi-*` CSS variables
// before first paint; TanStack Query owns server-cache state. Router and
// connection context are added as their phases land.
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeBoundary>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeBoundary>
  );
}
