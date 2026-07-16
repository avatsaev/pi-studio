/**
 * `use-terminals` — subscribes to the live list of every terminal running on the daemon (POC has
 * no equivalent; new in the modern app, mirrors `use-checkout-status.ts`'s subscribe/push
 * pattern). `subscribe_terminals_request` returns the current snapshot immediately; subsequent
 * `terminals_update` broadcasts (fired by the server on create/rename/kill, to every connected
 * session — not scoped to whoever subscribed) keep the store live without polling.
 */

import { useEffect } from "react";
import { useConnectionStore } from "../lib/connection/connection-store.js";
import { useTerminalStore, type TerminalRuntimeEntry } from "../stores/terminal-store.js";

interface TerminalsListResponse {
  terminals?: TerminalRuntimeEntry[];
}

interface TerminalsUpdateMessage {
  type: "terminals_update";
  terminals: TerminalRuntimeEntry[];
}

function isTerminalsUpdate(msg: unknown): msg is TerminalsUpdateMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    msg.type === "terminals_update" &&
    "terminals" in msg &&
    Array.isArray((msg as { terminals: unknown }).terminals)
  );
}

export function useTerminals(): void {
  const client = useConnectionStore((s) => s.client);
  const setTerminals = useTerminalStore((s) => s.setTerminals);

  useEffect(() => {
    if (!client) {
      setTerminals([]);
      return;
    }

    let cancelled = false;

    void client.connection
      .request<TerminalsListResponse>("subscribe_terminals_request", {})
      .then((res) => {
        if (!cancelled) setTerminals(res.terminals ?? []);
      })
      .catch(() => {});

    const unsubscribeMessages = client.connection.onSessionMessage((msg) => {
      if (cancelled) return;
      const raw: unknown = msg;
      if (!isTerminalsUpdate(raw)) return;
      setTerminals(raw.terminals);
    });

    return () => {
      cancelled = true;
      unsubscribeMessages();
      void client.connection.request("unsubscribe_terminals_request", {}).catch(() => {});
    };
  }, [client, setTerminals]);
}
