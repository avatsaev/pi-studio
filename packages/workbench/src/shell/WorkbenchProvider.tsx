import { type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeBoundary } from "@av-pi-studio/ui-library";
import { queryClient } from "../lib/connection/query-client.js";
// Application-wide rules every layout needs (the drag guard), not only the default shell.
import "../global.css";

// Top-level provider composition. ThemeBoundary applies `--pi-*` CSS variables
// before first paint; TanStack Query owns server-cache state.
export function WorkbenchProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeBoundary>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeBoundary>
  );
}
