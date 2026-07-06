/**
 * Portal — renders children into the global overlay root (#pi-portal-root).
 * design-system.md § Overlay & portal infrastructure
 */

import { createPortal } from "react-dom";
import { type ReactNode } from "react";

/** The id of the global fixed overlay root element (created by AppShell). */
export const PORTAL_ROOT_ID = "pi-portal-root";

export interface PortalProps {
  children: ReactNode;
  /** Custom mount element; defaults to #pi-portal-root. */
  container?: Element | null;
}

export function Portal({ children, container }: PortalProps) {
  const target =
    container ??
    (typeof document !== "undefined"
      ? document.getElementById(PORTAL_ROOT_ID)
      : null);

  if (!target) {
    // Fallback: render inline (e.g. SSR/tests).
    return <>{children}</>;
  }

  return createPortal(children, target);
}
