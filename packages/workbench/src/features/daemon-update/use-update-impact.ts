import { useEffect, useState } from "react";
import { isTerminalsUpdate } from "../../hooks/use-terminal-exit-watch.js";
import { useClient } from "../../lib/connection/connection-store.js";
import { useSessionStore } from "../../stores/session-store.js";
import {
  countLiveTerminals,
  countRunningAgents,
  countRunningListedAgents,
  type UpdateImpact,
} from "./daemon-update-dialog-view.js";

/**
 * What an update would stop, while `active`: running agents and terminals, both from the daemon's
 * own lists, so what another client started counts. Agents: `list_agents_request` on activation
 * and again whenever this client's own running count changes (the session store alone misses an
 * agent another client started after this one connected); until the answer, or when it fails, the
 * store's count stands in. Terminals: `list_terminals_request` on activation, then every
 * `terminals_update`; `terminals` is `null` until the first answer, and a broadcast that lands
 * before the list's answer wins: it is the newer one.
 */
export function useUpdateImpact(active: boolean): UpdateImpact {
  const client = useClient();
  const storeAgents = useSessionStore((s) =>
    countRunningAgents(Object.values(s.sessions).map((session) => session.status)),
  );
  const [listedAgents, setListedAgents] = useState<number | null>(null);
  const [terminals, setTerminals] = useState<number | null>(null);

  useEffect(() => {
    if (!active || !client) {
      setListedAgents(null);
      return;
    }
    let cancelled = false;
    client.connection
      .request<{ agents?: Array<{ status?: string }> }>("list_agents_request", { all: false })
      .then((response) => {
        if (!cancelled) setListedAgents(countRunningListedAgents(response.agents ?? []));
      })
      .catch(() => {
        // The store's count stands in.
      });
    return () => {
      cancelled = true;
    };
  }, [active, client, storeAgents]);

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

  return { agents: listedAgents ?? storeAgents, terminals };
}
