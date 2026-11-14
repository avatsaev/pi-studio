import { type ReactNode, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeBoundary } from "@av-pi-studio/ui-library";
import { getHost, installHost } from "../host/install.js";
import { type WorkbenchHost } from "../host/types.js";
import { queryClient } from "../lib/connection/query-client.js";
import { WorkbenchContext } from "./context.js";
// Application-wide rules every layout needs (the drag guard), not only the default shell.
import "../global.css";

export interface WorkbenchProviderProps {
  /** The embedding shell's host. Omitted: the browser host. Installed once; later changes are ignored. */
  host?: WorkbenchHost;
  children?: ReactNode;
}

// Top-level provider composition. The host is installed synchronously during the first render,
// before any child renders, because stores and persistence helpers read it outside React.
// ThemeBoundary applies `--pi-*` CSS variables before first paint (reading the host's storage);
// TanStack Query owns server-cache state. The context marks "inside a provider" for the public
// regions and hooks (`useRequireWorkbench`).
export function WorkbenchProvider({ host, children }: WorkbenchProviderProps) {
  const [installed] = useState(() => installHost(host ?? getHost()));
  // A different host passed on a later render is ignored; installHost warns once in development.
  if (host && host !== installed) installHost(host);
  return (
    <WorkbenchContext.Provider value={installed}>
      <ThemeBoundary store={installed.storage}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ThemeBoundary>
    </WorkbenchContext.Provider>
  );
}
