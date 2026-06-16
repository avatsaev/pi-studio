import {
  createWebSocketTransport,
  DaemonClient,
  type DaemonClientOptions,
  type Transport,
} from "@av-pi-studio/client";

import { resolveClientId, resolveHome } from "./client-id.js";

/** Default local daemon target (architecture/daemon-bootstrap.md). */
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 6767;

export interface ParsedHost {
  host: string;
  port: number;
  /** True when the value looked remote (explicit host given), false for the implicit local daemon. */
  explicit: boolean;
}

/**
 * Parse a `--host` value into host + port. Accepts `host`, `host:port`, `ws://host:port`,
 * `wss://host:port`. Missing port defaults to 6767 (features/cli.md § Global options).
 */
export function parseHost(value?: string): ParsedHost {
  if (!value || !value.trim()) {
    return { host: DEFAULT_HOST, port: DEFAULT_PORT, explicit: false };
  }
  let raw = value.trim();
  let secure = false;
  if (raw.startsWith("ws://")) raw = raw.slice(5);
  else if (raw.startsWith("wss://")) {
    raw = raw.slice(6);
    secure = true;
  } else if (raw.startsWith("http://")) raw = raw.slice(7);
  else if (raw.startsWith("https://")) {
    raw = raw.slice(8);
    secure = true;
  }
  raw = raw.replace(/\/+$/, "");

  const idx = raw.lastIndexOf(":");
  let host = raw;
  let port = secure ? 443 : DEFAULT_PORT;
  if (idx !== -1 && /^\d+$/.test(raw.slice(idx + 1))) {
    host = raw.slice(0, idx) || DEFAULT_HOST;
    port = Number(raw.slice(idx + 1));
  }
  return { host, port, explicit: true };
}

/** Build the WebSocket URL for a parsed host. */
export function hostToUrl(parsed: ParsedHost, secure = false): string {
  const scheme = secure ? "wss" : "ws";
  return `${scheme}://${parsed.host}:${parsed.port}`;
}

/** The WS subprotocol that carries the daemon password (browsers cannot set custom headers). */
export function bearerSubprotocol(password: string): string {
  return `pi-studio.bearer.${password}`;
}

/**
 * Build a direct WebSocket transport, optionally carrying the daemon password as a subprotocol
 * (architecture/auth-security.md § Password auth).
 */
function directTransport(password?: string): Transport {
  if (!password) return createWebSocketTransport();
  const protocols = [bearerSubprotocol(password)];
  type WsFactory = NonNullable<Parameters<typeof createWebSocketTransport>[0]>;
  const factory = ((url: string) => new WebSocket(url, protocols)) as unknown as WsFactory;
  return createWebSocketTransport(factory);
}

export interface ConnectOptions {
  /** Raw `--host` value. */
  host?: string;
  /** Daemon password (for password-protected daemons). */
  password?: string;
  /** `$PI_STUDIO_HOME` override (for the client-id store). */
  home?: string;
  /** Inject a transport (tests / relay). Defaults to a direct WebSocket transport. */
  transport?: Transport;
  /** Override the resolved client id (tests). */
  clientId?: string;
  /** RPC timeout (ms). */
  rpcTimeoutMs?: number;
}

/**
 * Build (but do not connect) a `DaemonClient` for the given global options. The CLI presents a
 * stable `clientId` with `clientType: "cli"` (features/cli.md § Data & Persistence).
 */
export function buildDaemonClient(opts: ConnectOptions): DaemonClient {
  const parsed = parseHost(opts.host);
  const home = opts.home ?? resolveHome();
  const clientId = opts.clientId ?? resolveClientId(home);

  const capabilities: Record<string, boolean> = {};
  const clientOptions: DaemonClientOptions = {
    url: hostToUrl(parsed),
    clientId,
    clientType: "cli",
    capabilities,
    transport: opts.transport ?? directTransport(opts.password),
    ...(opts.rpcTimeoutMs !== undefined ? { rpcTimeoutMs: opts.rpcTimeoutMs } : {}),
  };
  return new DaemonClient(clientOptions);
}

/** Build and connect a `DaemonClient`, completing the hello handshake. */
export async function connectDaemon(
  opts: ConnectOptions,
): Promise<{ client: DaemonClient; serverInfo: Awaited<ReturnType<DaemonClient["connect"]>> }> {
  const client = buildDaemonClient(opts);
  const serverInfo = await client.connect();
  return { client, serverInfo };
}
