/**
 * Connection store — Zustand wrapper around `DaemonClient` + `PiStudioClient`
 * (@av-pi-studio/client). Replaces the POC's raw `WebSocket`/`doConnect()`/`rpc()` globals
 * (POC_TO_APP_PLAN_UI.md §4.1). No raw WebSockets outside this module.
 */

import { create } from "zustand";
import {
  DaemonClient,
  PiStudioClient,
  ReconnectionManager,
  createWebSocketTransport,
  type ConnectionState,
} from "@av-pi-studio/client";
import type { ServerInfoPayload } from "@av-pi-studio/protocol";

export interface ConnectOptions {
  /** `ws://host:port` (or `wss://…`). */
  url: string;
  /** Bearer password, sent via the `pi-studio.bearer.<pw>` WS subprotocol. */
  password?: string;
  /** Stable per-tab client id; generated once if omitted. */
  clientId?: string;
}

interface ConnectionStoreState {
  status: ConnectionState;
  serverInfo: ServerInfoPayload | null;
  error: string | null;
  /** Non-null once `connect()` has ever succeeded — the live SDK handles. */
  daemon: DaemonClient | null;
  client: PiStudioClient | null;
  reconnection: ReconnectionManager | null;

  connect(opts: ConnectOptions): Promise<void>;
  disconnect(): void;
}

function generateClientId(): string {
  return "web-" + Math.random().toString(36).slice(2, 10);
}

export const useConnectionStore = create<ConnectionStoreState>()((set, get) => ({
  status: "idle",
  serverInfo: null,
  error: null,
  daemon: null,
  client: null,
  reconnection: null,

  async connect(opts) {
    // Tear down any previous connection before opening a new one.
    get().disconnect();

    const transport = opts.password
      ? createWebSocketTransport(
          (url) => new WebSocket(url, [`pi-studio.bearer.${opts.password}`]) as unknown as never,
        )
      : undefined;

    const daemon = new DaemonClient({
      url: opts.url,
      clientId: opts.clientId ?? generateClientId(),
      clientType: "browser",
      capabilities: {},
      transport,
      // The PiStudioClient facade has no per-call timeout override for
      // createAgent/send/interrupt, and agent turns can run far longer than a
      // typical RPC (POC used a 30 min turn timeout). One rpcTimeoutMs applies
      // to every request on this connection, so size it for the longest op.
      rpcTimeoutMs: 30 * 60 * 1000,
    });
    const client = new PiStudioClient(daemon);
    const reconnection = new ReconnectionManager(daemon);

    daemon.onStateChange((state) => set({ status: state }));
    reconnection.onReconnected(() => set({ error: null }));
    reconnection.onReconnectFailed((error) => {
      set({ error: error instanceof Error ? error.message : String(error) });
    });

    set({ daemon, client, reconnection, error: null, status: "connecting" });

    try {
      const info = await daemon.connect();
      set({ serverInfo: info });
      reconnection.start();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  disconnect() {
    const { daemon, reconnection } = get();
    reconnection?.stop();
    daemon?.close();
    set({
      status: "idle",
      serverInfo: null,
      daemon: null,
      client: null,
      reconnection: null,
    });
  },
}));

/** Convenience selector: the live `PiStudioClient`, or `null` when disconnected. */
export function useClient(): PiStudioClient | null {
  return useConnectionStore((s) => s.client);
}

/** Convenience selector: current connection lifecycle state. */
export function useConnectionStatus(): ConnectionState {
  return useConnectionStore((s) => s.status);
}
