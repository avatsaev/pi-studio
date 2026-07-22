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
  createRelayTransport,
  createWebSocketTransport,
  type ConnectionState,
  type Transport,
} from "@av-pi-studio/client";
import type { ServerInfoPayload } from "@av-pi-studio/protocol";
import { resolveConnectTarget } from "./resolve-connect-target.js";

export interface ConnectOptions {
  /**
   * Daemon address, OR a full pairing link (`https://app.pi-studio.sh/#offer=...`) copied from
   * `pi-studio daemon pair`. A pairing link is detected via {@link parsePairingUrl} and switches
   * this connection to the relay transport automatically — see {@link connectViaPairingOffer}.
   * Otherwise accepts `ws://`/`wss://`, `http://`/`https://` (mapped to `ws`/`wss`), or a bare
   * `host[:port]` (assumed `ws://`), normalized via {@link normalizeDaemonUrl}.
   */
  url: string;
  /** Bearer password, sent via the `pi-studio.bearer.<pw>` WS subprotocol. Ignored for a pairing-link (relay) connection — the pairing link's public key is itself the credential. */
  password?: string;
  /** Stable per-tab client id; generated once if omitted. */
  clientId?: string;
}

interface ConnectionStoreState {
  status: ConnectionState;
  serverInfo: ServerInfoPayload | null;
  error: string | null;
  /** Canonical identity of the live direct or relay target; null when disconnected. */
  connectedTarget: string | null;
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

function connectionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  if (typeof error === "string" && error.trim() !== "") return error;
  return "Unable to connect to the daemon";
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Canonical identity used to compare saved entries with the current connection. */
export function connectionTargetKey(input: string): string {
  const target = resolveConnectTarget(input);
  return target.mode === "direct"
    ? `direct:${target.url}`
    : `relay:${target.url}:${bytesToHex(target.daemonPublicKey)}`;
}

export function isConnectedToDaemon(
  status: ConnectionState,
  connectedTarget: string | null,
  input: string,
): boolean {
  return status === "open" && connectedTarget === connectionTargetKey(input);
}

export const useConnectionStore = create<ConnectionStoreState>()((set, get) => ({
  status: "idle",
  serverInfo: null,
  error: null,
  connectedTarget: null,
  daemon: null,
  client: null,
  reconnection: null,

  async connect(opts) {
    // Tear down any previous connection before opening a new one.
    get().disconnect();

    // A pasted pairing link (`pi-studio daemon pair`'s QR/link) takes over connection setup
    // entirely: it carries the daemon's public key plus either a relay endpoint (branch to the
    // E2EE relay transport, ignoring `opts.password` — the pairing key IS the credential) or a
    // direct host hint (connect there exactly like a typed `url`, no password support in that
    // form since a pairing link is generated once and doesn't carry one).
    const target = resolveConnectTarget(opts.url);

    let transport: Transport | undefined;
    if (target.mode === "relay") {
      transport = createRelayTransport({ daemonPublicKey: target.daemonPublicKey });
    } else if (opts.password) {
      transport = createWebSocketTransport(
        (u) => new WebSocket(u, [`pi-studio.bearer.${opts.password}`]) as unknown as never,
      );
    }

    const daemon = new DaemonClient({
      url: target.url,
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
      set({ error: connectionErrorMessage(error) });
    });

    set({ daemon, client, reconnection, error: null, status: "connecting" });

    try {
      const info = await daemon.connect();
      set({ serverInfo: info, connectedTarget: connectionTargetKey(opts.url) });
      reconnection.start();
    } catch (error) {
      set({ error: connectionErrorMessage(error) });
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
      connectedTarget: null,
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
