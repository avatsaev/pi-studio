import { useEffect, useState } from "react";
import { isTerminalsUpdate } from "../../hooks/use-terminal-exit-watch.js";
import { useClient } from "../../lib/connection/connection-store.js";
import { useSessionStore } from "../../stores/session-store.js";
import {
  countLiveTerminals,
  countRunningAgents,
  type UpdateImpact,
} from "./daemon-update-dialog-view.js";

/**
 * What an update would stop, while `active`: running agents from the session store, and terminals
 * from the daemon's own list (`list_terminals_request` on activation, then every
 * `terminals_update`), so terminals another client opened count. `terminals` is `null` until the
 * first answer. A broadcast that lands before the list's answer wins: it is the newer one.
 */
export function useUpdateImpact(active: boolean): UpdateImpact {
  const client = useClient();
  const agents = useSessionStore((s) =>
    countRunningAgents(Object.values(s.sessions).map((session) => session.status)),
  );
  const [terminals, setTerminals] = useState<number | null>(null);

  useEffect(() => {
    if (!active || !client) {
      setTerminals(null);
      return;
    }
    let cancelled = false;
    let fromBroadcast = false;
    const unsubscribe = client.connection.onSessionMessage((message) => {
      const pushed: unknown = message;
      if (!isTerminalsUpdate(pushed)) return;
      fromBroadcast = true;
      setTerminals(pushed.terminals.length);
    });
    client.connection
      .request<{ terminals?: Array<{ closed?: boolean }> }>("list_terminals_request", {})
      .then((response) => {
        if (!cancelled && !fromBroadcast)
          setTerminals(countLiveTerminals(response.terminals ?? []));
      })
      .catch(() => {
        // Stays "counting": the confirmation still works without the terminals' number.
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [active, client]);

  return { agents, terminals };
}
