/** True for hosts that only accept connections from this machine. */
export function isLoopbackHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "localhost" || h.endsWith(".localhost")) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

export const UNPROTECTED_BIND_WARNING =
  "daemon is reachable beyond this machine with no password — set PI_STUDIO_PASSWORD or bind 127.0.0.1";
