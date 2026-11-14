import { createContext, useContext } from "react";
import { type WorkbenchHost } from "../host/types.js";

/** Present (the installed host) inside `WorkbenchProvider`, `null` outside it. */
export const WorkbenchContext = createContext<WorkbenchHost | null>(null);

/** Every public region and hook calls this first, so misuse fails with a message that says what
 *  is missing instead of an obscure store or theme error further down. */
export function useRequireWorkbench(name: string): WorkbenchHost {
  const host = useContext(WorkbenchContext);
  if (!host) {
    throw new Error(
      `${name} must be rendered inside <WorkbenchProvider> (or <Workbench>, which includes it).`,
    );
  }
  return host;
}

/** Logs `message` once per key, in development only. */
const warned = new Set<string>();
export function warnOnce(key: string, message: string): void {
  if (process.env.NODE_ENV === "production" || warned.has(key)) return;
  warned.add(key);
  console.warn(`[workbench] ${message}`);
}
