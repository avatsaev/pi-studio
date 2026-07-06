/**
 * ConnectionProvider — wires the PiStudioClient to the app on startup.
 *
 * On mount: reads daemon address from KV → creates DaemonClient → connects →
 * subscribes session store to broadcast events → drives boot gate.
 *
 * On disconnect: shows toast, triggers auto-reconnect via ReconnectionManager.
 * On reconnect: re-subscribes, refetches active sessions.
 *
 * See: clean-room-scope/architecture/client-app-runtime.md § connection provider, § boot sequence
 *      clean-room-scope/architecture/daemon-bootstrap.md § hello handshake
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DaemonClient, type ConnectionState } from "@av-pi-studio/client";
import { PiStudioClient, ReconnectionManager } from "@av-pi-studio/client";
import { subscribeSessionStore } from "../hooks/use-session-hooks.js";
import { useSessionStore } from "../store/session-store.js";
import { ClientProvider } from "../hooks/client-context.js";
import type { KeyValueStore } from "./kv-store.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const DAEMON_ADDRESS_KEY = "pi-studio-daemon-address";
export const DEFAULT_DAEMON_ADDRESS = "ws://127.0.0.1:6767";

/**
 * Computes the default daemon WS address using the SAME origin (host + port)
 * the page was loaded from, proxied through Vite's dev-server WS proxy
 * (`/daemon-ws` → the real daemon port). This avoids requiring a second
 * network-reachable port across NAT/firewall boundaries — whatever delivered
 * the page will also carry the proxied WS traffic.
 *
 * Falls back to `DEFAULT_DAEMON_ADDRESS` when `window` is unavailable (SSR/tests).
 */
export function getDefaultDaemonAddress(): string {
  if (typeof window === "undefined" || !window.location) return DEFAULT_DAEMON_ADDRESS;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/daemon-ws`;
}

/**
 * Seed the session store with the daemon's existing agents (directory listing)
 * so the sidebar, sessions list, and per-agent timelines work for agents this
 * client didn't create in the current session.
 */
async function seedAgentsFromDaemon(daemon: DaemonClient): Promise<void> {
  try {
    const resp = await daemon.request<{ agents?: Array<Record<string, unknown>> }>(
      "list_agents_request",
      {},
    );
    const agents = resp?.agents ?? [];
    const store = useSessionStore.getState();
    for (const a of agents) {
      const agentId = a["agentId"] as string | undefined;
      if (!agentId) continue;
      store.upsertAgent({
        agentId,
        ...(a["status"] !== undefined && { status: a["status"] as never }),
        ...(a["title"] !== undefined && { title: a["title"] as string }),
        ...(a["cwd"] !== undefined && { cwd: a["cwd"] as string }),
        ...(a["labels"] !== undefined && { labels: a["labels"] as Record<string, string> }),
        ...(a["workspaceId"] !== undefined && { workspaceId: a["workspaceId"] as string }),
      });
    }
  } catch {
    /* directory seed is best-effort */
  }
}

// ─── Connection context ───────────────────────────────────────────────────────

export type AppConnectionStatus =
  | "no-hosts"        // No daemon address configured
  | "connecting"      // Attempting initial connection
  | "connected"       // Fully connected, session store populated
  | "reconnecting"    // Lost connection, retrying
  | "error";          // Failed to connect / fatal

export interface ConnectionContextValue {
  status: AppConnectionStatus;
  serverId: string | null;
  version: string | undefined;
  /** Manually trigger a reconnect (e.g. after user edits address). */
  reconnect(): void;
  /** Update the daemon address and reconnect. */
  setAddress(address: string): void;
  /** Current daemon address. */
  address: string | null;
}

const ConnectionContext = createContext<ConnectionContextValue>({
  status: "no-hosts",
  serverId: null,
  version: undefined,
  reconnect: () => {},
  setAddress: () => {},
  address: null,
});

export function useConnectionStatus(): ConnectionContextValue {
  return useContext(ConnectionContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface ConnectionProviderProps {
  children: ReactNode;
  kvStore: KeyValueStore;
  /** Injected for testing. Defaults to creating a real DaemonClient. */
  clientFactory?: (address: string) => { daemon: DaemonClient; client: PiStudioClient };
}

export function ConnectionProvider({
  children,
  kvStore,
  clientFactory,
}: ConnectionProviderProps) {
  const qc = useQueryClient();

  const [status, setStatus] = useState<AppConnectionStatus>("connecting");
  const [serverId, setServerId] = useState<string | null>(null);
  const [version, setVersion] = useState<string | undefined>(undefined);
  const [address, setAddressState] = useState<string | null>(
    () => kvStore.get(DAEMON_ADDRESS_KEY),
  );
  const [client, setClient] = useState<PiStudioClient | null>(null);

  const reconnectMgrRef = useRef<ReconnectionManager | null>(null);
  const unsubStoreRef = useRef<(() => void) | null>(null);

  // ── Effect: connect on mount / address change ──────────────────────────────

  useEffect(() => {
    const addr = address ?? getDefaultDaemonAddress();

    // Tear down previous connection
    reconnectMgrRef.current?.stop();
    unsubStoreRef.current?.();
    setStatus("connecting");
    setClient(null);

    // Create client instances
    let daemon: DaemonClient;
    let piClient: PiStudioClient;

    if (clientFactory) {
      const result = clientFactory(addr);
      daemon = result.daemon;
      piClient = result.client;
    } else {
      daemon = new DaemonClient({
        url: addr,
        clientId: crypto.randomUUID?.() ?? `pi-app-${Date.now()}`,
        clientType: "browser",
      });
      piClient = new PiStudioClient(daemon);
    }

    // Subscribe session store to broadcast events
    const unsubStore = subscribeSessionStore(piClient as never);
    unsubStoreRef.current = unsubStore;
    setClient(piClient);

    // Track connection state changes
    const unsubState = daemon.onStateChange((state: ConnectionState) => {
      if (state === "open") {
        setStatus("connected");
        const sid = daemon.serverId;
        setServerId(sid);
        if (sid) {
          useSessionStore.getState().setActiveServer(sid);
          useSessionStore.getState().setServerInfo({ serverId: sid });
        }
        // Seed the session store with the daemon's existing agents. Without
        // this, agents created by other clients (or before this session) never
        // enter the store, leaving the sidebar empty and their timelines blank
        // (mergePage/applyStreamEvent no-op for unknown agents).
        void seedAgentsFromDaemon(daemon);
        // Refetch active sessions on (re)connect
        qc.invalidateQueries({ queryKey: ["sessions"] });
      } else if (state === "closed" || state === "closing") {
        setStatus("reconnecting");
        useSessionStore.getState().clearAllAgents();
      }
    });

    // Start reconnect manager
    const mgr = new ReconnectionManager(daemon);
    mgr.onReconnected(({ serverId: sid }) => {
      setStatus("connected");
      if (sid) {
        setServerId(sid);
        useSessionStore.getState().setActiveServer(sid);
        useSessionStore.getState().setServerInfo({ serverId: sid });
      }
      void seedAgentsFromDaemon(daemon);
      qc.invalidateQueries({ queryKey: ["sessions"] });
    });
    mgr.start();
    reconnectMgrRef.current = mgr;

    // Initiate the connection
    void daemon.connect().catch(() => {
      setStatus("error");
    });

    return () => {
      mgr.stop();
      unsubState();
      unsubStore();
      try { daemon.close(); } catch { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // ── Helpers exposed via context ────────────────────────────────────────────

  const reconnect = () => {
    // Force re-run the effect by re-setting the address state
    setAddressState((prev) => prev);
    setStatus("connecting");
  };

  const setAddress = (newAddr: string) => {
    kvStore.set(DAEMON_ADDRESS_KEY, newAddr);
    setAddressState(newAddr);
  };

  const contextValue: ConnectionContextValue = {
    status,
    serverId,
    version,
    reconnect,
    setAddress,
    // Expose the *effective* address we actually connect to (the stored one,
    // or the default same-origin proxy). Downstream host snapshots key off
    // this; exposing the raw null here left hosts empty and stranded boot.
    address: address ?? getDefaultDaemonAddress(),
  };

  return (
    <ConnectionContext.Provider value={contextValue}>
      <ClientProvider client={client}>
        {children}
      </ClientProvider>
    </ConnectionContext.Provider>
  );
}
