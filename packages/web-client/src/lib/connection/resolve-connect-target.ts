/**
 * Pure decision logic for `connect()`: given whatever the user typed or pasted into the host
 * field, decide whether this is a direct daemon address or a pairing link (optionally
 * relay-routed) — see `pi-studio daemon pair` / architecture/relay-e2ee.md § Pairing.
 *
 * Kept separate from `connection-store.ts` (which has the side-effecting `DaemonClient`/transport
 * construction) so the routing decision itself is unit-testable without a live socket.
 */
import { parsePairingUrl, relayDialUrl } from "@av-pi-studio/client";
import { normalizeDaemonUrl } from "./normalize-url.js";

export type ConnectTarget =
  | { mode: "direct"; url: string }
  | { mode: "relay"; url: string; daemonPublicKey: Uint8Array };

/**
 * Resolve what to connect to and how. `input` may be a plain daemon address (`ws://`, `http://`,
 * bare `host:port`) or a full pairing link. A pairing link with a `relay` offer routes to
 * `{ mode: "relay", ... }` (the relay's own dial URL, not the daemon's); a pairing link with a
 * `host` hint routes to `{ mode: "direct", url: <that host> }`; anything else is treated as a
 * plain daemon address, normalized via {@link normalizeDaemonUrl}.
 */
export function resolveConnectTarget(input: string): ConnectTarget {
  const offer = parsePairingUrl(input);
  if (offer?.relay) {
    return { mode: "relay", url: relayDialUrl(offer.relay), daemonPublicKey: offer.publicKey };
  }
  if (offer?.host) {
    return { mode: "direct", url: normalizeDaemonUrl(offer.host) };
  }
  return { mode: "direct", url: normalizeDaemonUrl(input) };
}
