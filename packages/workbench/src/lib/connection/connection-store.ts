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
import { CLIENT_CAPS } from "@av-pi-studio/protocol";
import { resolveConnectTarget } from "./resolve-connect-target.js";
import { createWorkerTimers } from "./worker-timers.js";
import { clearInlineImageCache } from "../inline-image-cache.js";

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
      capabilities: {
        [CLIENT_CAPS.inline_image_markdown]: true,
        [CLIENT_CAPS.file_link_markdown]: true,
        [CLIENT_CAPS.mermaid_diagram_markdown]: true,
        // Connection-wide claim (sprint-053/task-005): once advertised, EVERY terminal
        // subscription on this connection is eligible for the daemon's reflowable `Restore`
        // tier (terminals.md § Restore / snapshot) — TerminalPanel.tsx requests it and shares
        // one reset-then-write replay path for both tiers, so this is safe to claim
        // unconditionally rather than per-subscription.
        [CLIENT_CAPS.terminal_reflowable_snapshot]: true,
      },
      transport,
      // The PiStudioClient facade has no per-call timeout override for
      // createAgent/send/interrupt, and agent turns can run far longer than a
      // typical RPC (POC used a 30 min turn timeout). One rpcTimeoutMs applies
      // to every request on this connection, so size it for the longest op.
      rpcTimeoutMs: 30 * 60 * 1000,
    });
    const client = new PiStudioClient(daemon);
    // Worker-backed timers keep backoff scheduling accurate in a hidden/throttled tab (sprint-050
    // connection-resilience) — falls back to plain setTimeout when Worker construction is
    // unavailable, identical to pre-sprint-050 behavior.
    const { setTimer, clearTimer } = createWorkerTimers();
    const reconnection = new ReconnectionManager(daemon, { setTimer, clearTimer });

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
    // A reconnect must not leak object URLs pointing at a now-dead transfer instance
    // (`transferFor` is per-daemon-instance; this cache is global — see its module header).
    clearInlineImageCache();
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

/**
 * The daemon host's home directory as reported in `server_info` (`homeDir`), or `null` when it is
 * unknown — no connection yet, or a daemon predating the field. The imperative counterpart to
 * `hooks/use-home-dir.ts`, for the non-React restore paths.
 *
 * Never derive this client-side: the browser may run on macOS (`/Users/<me>`) against a Linux
 * daemon (`/home/<me>`) or vice versa, and only the daemon's own value expands a `~` cwd correctly.
 */
export function daemonHomeDir(): string | null {
  return useConnectionStore.getState().serverInfo?.homeDir ?? null;
}
