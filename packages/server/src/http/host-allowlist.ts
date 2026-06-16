import { isIP } from "node:net";

/**
 * Host-header allowlist — DNS-rebinding defense (architecture/auth-security.md § Host-header
 * allowlist). Vite-style: `localhost`, `*.localhost`, and any literal IP are always allowed;
 * `hostnames` extends the list (a `.`-prefixed entry matches a domain and its subdomains); the
 * literal value `true` disables validation entirely.
 */

export type HostnamesSetting = true | string[];

/** Extract the bare hostname (lowercased, port + IPv6 brackets stripped) from a Host header. */
export function parseHostHeader(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const value = hostHeader.trim();
  if (value.length === 0) return null;

  // IPv6 literal: [::1] or [::1]:6767
  const bracket = value.match(/^\[(.+)\](?::\d+)?$/);
  if (bracket) return (bracket[1] as string).toLowerCase();

  // Strip a trailing :port (only when it is numeric).
  const idx = value.lastIndexOf(":");
  if (idx !== -1 && /^\d+$/.test(value.slice(idx + 1))) {
    return value.slice(0, idx).toLowerCase();
  }
  return value.toLowerCase();
}

/**
 * Build a Host-header checker for the given `hostnames` setting. Returns a predicate over the raw
 * Host header value.
 */
export function createHostChecker(
  hostnames: HostnamesSetting,
): (hostHeader: string | undefined) => boolean {
  if (hostnames === true) return () => true;

  const extra = hostnames.map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0);

  return (hostHeader) => {
    const host = parseHostHeader(hostHeader);
    if (host === null) return false;

    // Always-allowed: localhost, *.localhost, and any literal IP (v4/v6).
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (isIP(host) !== 0) return true;

    for (const entry of extra) {
      if (entry === "true") return true; // defensive: `true` in an array still disables
      if (entry.startsWith(".")) {
        // ".example.com" matches example.com and any subdomain.
        if (host === entry.slice(1) || host.endsWith(entry)) return true;
      } else if (host === entry) {
        return true;
      }
    }
    return false;
  };
}
