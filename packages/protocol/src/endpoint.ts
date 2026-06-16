/**
 * Daemon endpoint / host parsing (MAIN-SCOPE §4 protocol responsibilities).
 *
 * Parses a daemon target into a normalized descriptor. Supported forms:
 *  - `host:port` / `host`                      → direct (default port 6767)
 *  - `tcp://host:port?ssl=&password=`          → direct, with ssl/password params
 *  - `ws://host:port` / `wss://host:port`      → direct (wss ⇒ ssl)
 *  - `relay://relayHost[:port]/<relayId>?...`  → relay
 */

/** Default daemon listen port (MAIN-SCOPE §2: `127.0.0.1:6767`). */
export const DEFAULT_DAEMON_PORT = 6767;

export interface EndpointDescriptor {
  kind: "direct" | "relay";
  host: string;
  port: number;
  ssl: boolean;
  password?: string;
  /** Relay channel/server id (relay endpoints only). */
  relayId?: string;
  /** The original input string. */
  raw: string;
}

function truthyFlag(value: string | null): boolean {
  if (value === null) return false;
  const v = value.trim().toLowerCase();
  return v === "" ? true : v === "1" || v === "true" || v === "yes" || v === "on";
}

function splitHostPort(authority: string, defaultPort: number): { host: string; port: number } {
  // IPv6 literal in brackets: [::1]:6767
  const bracket = authority.match(/^\[(.+)\](?::(\d+))?$/);
  if (bracket) {
    return { host: bracket[1] as string, port: bracket[2] ? Number(bracket[2]) : defaultPort };
  }
  const idx = authority.lastIndexOf(":");
  if (idx === -1) return { host: authority, port: defaultPort };
  const host = authority.slice(0, idx);
  const portStr = authority.slice(idx + 1);
  const port = Number(portStr);
  return { host, port: Number.isFinite(port) && portStr !== "" ? port : defaultPort };
}

/** Parse a daemon target string into a normalized {@link EndpointDescriptor}. */
export function parseEndpoint(input: string, opts?: { defaultPort?: number }): EndpointDescriptor {
  const raw = input.trim();
  if (raw === "") throw new Error("empty endpoint");
  const defaultPort = opts?.defaultPort ?? DEFAULT_DAEMON_PORT;

  const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (!schemeMatch) {
    // Bare `host` or `host:port`.
    const { host, port } = splitHostPort(raw, defaultPort);
    return { kind: "direct", host, port, ssl: false, raw };
  }

  const scheme = (schemeMatch[1] as string).toLowerCase();
  const url = new URL(raw);
  const params = url.searchParams;
  const password = params.get("password") ?? undefined;

  if (scheme === "relay") {
    const port = url.port ? Number(url.port) : defaultPort;
    const relayId = url.pathname.replace(/^\/+/, "") || params.get("relayId") || undefined;
    const ssl = truthyFlag(params.get("ssl")) || truthyFlag(params.get("tls"));
    return {
      kind: "relay",
      host: url.hostname,
      port,
      ssl,
      ...(password !== undefined ? { password } : {}),
      ...(relayId ? { relayId } : {}),
      raw,
    };
  }

  // direct schemes: tcp, ws, wss, http, https
  const sslFromScheme = scheme === "wss" || scheme === "https";
  const ssl = sslFromScheme || truthyFlag(params.get("ssl")) || truthyFlag(params.get("tls"));
  const port = url.port ? Number(url.port) : defaultPort;
  return {
    kind: "direct",
    host: url.hostname,
    port,
    ssl,
    ...(password !== undefined ? { password } : {}),
    raw,
  };
}
