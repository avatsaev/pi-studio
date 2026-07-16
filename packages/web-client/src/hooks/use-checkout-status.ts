/**
 * `use-checkout-status` — subscribes to live git checkout status for a cwd (POC `loadChanges` +
 * `handleCheckoutStatusUpdate`, POC_TO_APP_PLAN_UI.md §4.7 / §3 `hooks/use-checkout-status.ts`).
 * On `cwd` change: unsubscribes the previous cwd (`checkout_status_unsubscribe`), subscribes the
 * new one (`checkout_status_subscribe`), and routes pushed `checkout_status_update` session
 * messages into `git-store`. Cleans up both the RPC subscription and the message handler on
 * unmount/cwd-change — the POC leaked subscriptions on cwd change (§4.7).
 */

import { useEffect, useRef } from "react";
import { useConnectionStore } from "../lib/connection/connection-store.js";
import { useGitStore, type CheckoutStatusProjection } from "../stores/git-store.js";

interface CheckoutStatusUpdateMessage {
  type: "checkout_status_update";
  cwd: string;
  projection: CheckoutStatusProjection;
}

function isCheckoutStatusUpdate(msg: unknown): msg is CheckoutStatusUpdateMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    msg.type === "checkout_status_update" &&
    "cwd" in msg &&
    typeof msg.cwd === "string" &&
    "projection" in msg &&
    typeof msg.projection === "object" &&
    msg.projection !== null
  );
}

export interface UseCheckoutStatusResult {
  refresh(): void;
}

export function useCheckoutStatus(cwd: string): UseCheckoutStatusResult {
  const client = useConnectionStore((s) => s.client);
  const applyProjection = useGitStore((s) => s.applyProjection);
  const setSubscribedCwd = useGitStore((s) => s.setSubscribedCwd);
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    if (!client || !cwd) return;

    let cancelled = false;
    void client.connection.request("checkout_status_subscribe", { cwd }).catch(() => {});
    setSubscribedCwd(cwd);

    const unsubscribeMessages = client.connection.onSessionMessage((msg) => {
      if (cancelled) return;
      const raw: unknown = msg;
      if (!isCheckoutStatusUpdate(raw)) return;
      if (raw.cwd !== cwd) return;
      applyProjection(raw.projection);
    });

    void client.connection.request("checkout_refresh_request", { cwd }).catch(() => {});

    return () => {
      cancelled = true;
      unsubscribeMessages();
      void client.connection.request("checkout_status_unsubscribe", { cwd }).catch(() => {});
      setSubscribedCwd(null);
    };
  }, [client, cwd, applyProjection, setSubscribedCwd]);

  return {
    refresh() {
      const current = clientRef.current;
      if (!current || !cwd) return;
      void current.connection.request("checkout_refresh_request", { cwd }).catch(() => {});
    },
  };
}
