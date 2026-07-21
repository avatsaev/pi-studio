/**
 * Boot hook: seeds the toolbar (host/password/cwd) from URL params
 * (POC `?host=&password=&cwd=&connect=1`, POC_TO_APP_PLAN_UI.md §4.1) and optionally
 * auto-connects. Runs once on mount.
 *
 * Also supports opening the web-client directly from a pairing link
 * (`pi-studio daemon pair`'s QR/link, architecture/relay-e2ee.md § Pairing):
 *  - `location.hash` already carrying `#offer=...` (the web-client's own URL was used as the
 *    pairing link's `baseUrl`) — connects immediately, no `connect=1` needed, since a pairing
 *    link's entire purpose is a one-click connect.
 *  - `?pair=<url-encoded pairing link>` — for pasting a link whose `baseUrl` is the hosted
 *    `app.pi-studio.sh` landing page into `?pair=` instead of the fragment directly (mirrors the
 *    existing `?host=&connect=1` convention).
 * Either form is handed to `connect()` verbatim — it detects the pairing link itself via
 * `parsePairingUrl` and branches to the relay transport when the link carries one.
 */

import { useEffect, useRef } from "react";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";

export function useConnectionBoot(): void {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    // A pairing link landed directly on this origin (hash carries `offer=`) — connect immediately.
    if (window.location.hash.includes("offer=")) {
      const pairingUrl = window.location.href;
      useUiStore.getState().setHost(pairingUrl);
      void useConnectionStore.getState().connect({ url: pairingUrl });
      return;
    }

    const qs = new URLSearchParams(window.location.search);
    const host = qs.get("host");
    const pair = qs.get("pair");
    const password = qs.get("password");
    const cwd = qs.get("cwd");
    const shouldConnect = qs.get("connect") === "1";

    const ui = useUiStore.getState();
    if (pair) ui.setHost(pair);
    else if (host) ui.setHost(host);
    if (password) ui.setPassword(password);
    if (cwd) ui.setCwd(cwd);

    if (pair) {
      // A pairing link carries its own credential (the daemon's public key) — connect
      // unconditionally, `connect=1` is only required for a plain host/password connection.
      void useConnectionStore.getState().connect({ url: pair });
    } else if (shouldConnect) {
      const { host: h, password: pw } = useUiStore.getState();
      void useConnectionStore.getState().connect({ url: h, password: pw || undefined });
    }
  }, []);
}
