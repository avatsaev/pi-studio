/**
 * Normalize a user-typed daemon address into the `ws://` / `wss://` URL that
 * `DaemonClient` (via the browser `WebSocket`) actually opens.
 *
 * The daemon is a single HTTP server that upgrades to WebSocket on the same port, so users may
 * type whichever scheme they're familiar with:
 *  - `http://host[:port]`  → `ws://host[:port]`
 *  - `https://host[:port]` → `wss://host[:port]`
 *  - `ws://` / `wss://`    → used as-is
 *  - bare `host[:port]`    → `ws://host[:port]`
 *
 * `new WebSocket("http://…")` throws in browsers, so this MUST run before the URL reaches the
 * transport. Trailing slashes are trimmed; the input is otherwise left intact (path, query).
 */
export function normalizeDaemonUrl(input: string): string {
  const raw = input.trim();
  if (raw === "") return raw;

  const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (!schemeMatch) {
    // Bare host or host:port.
    return `ws://${raw.replace(/\/+$/, "")}`;
  }

  const scheme = (schemeMatch[1] as string).toLowerCase();
  const rest = raw.slice(schemeMatch[0].length).replace(/\/+$/, "");

  switch (scheme) {
    case "http":
      return `ws://${rest}`;
    case "https":
      return `wss://${rest}`;
    case "ws":
    case "wss":
      return `${scheme}://${rest}`;
    default:
      // Unknown scheme — leave it to the transport to reject with a clear error.
      return raw;
  }
}
