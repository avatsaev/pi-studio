/**
 * Boot hook: seeds the toolbar (host/password/cwd) from URL params
 * (POC `?host=&password=&cwd=&connect=1`, POC_TO_APP_PLAN_UI.md §4.1) and optionally
 * auto-connects. Runs once on mount.
 */

import { useEffect, useRef } from "react";
import { useConnectionStore } from "../lib/connection/connection-store.js";
import { useUiStore } from "../stores/ui-store.js";

export function useConnectionBoot(): void {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const qs = new URLSearchParams(window.location.search);
    const host = qs.get("host");
    const password = qs.get("password");
    const cwd = qs.get("cwd");
    const shouldConnect = qs.get("connect") === "1";

    const ui = useUiStore.getState();
    if (host) ui.setHost(host);
    if (password) ui.setPassword(password);
    if (cwd) ui.setCwd(cwd);

    if (shouldConnect) {
      const { host: h, password: pw } = useUiStore.getState();
      void useConnectionStore.getState().connect({ url: h, password: pw || undefined });
    }
  }, []);
}
