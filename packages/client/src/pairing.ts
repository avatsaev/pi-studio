/**
 * Client-side pairing helpers (architecture/relay-e2ee.md § Pairing). Parses the pairing URL
 * produced by `packages/cli/src/pairing.ts#buildPairingUrl` — the daemon's persistent Curve25519
 * public key rides in the URL **fragment** (`#offer=<base64>&host=<...>` or, for a relay-routed
 * daemon, `#offer=<base64>&relay=<endpoint>&relayTls=<0|1>`), which a browser/RN client never
 * sends to the web server hosting the pairing page (`app.pi-studio.sh`). Treat the decoded key
 * like a password (trust anchor) — see relay-e2ee.md § Pairing.
 */
import { decodeBase64 } from "@av-pi-studio/relay";

export interface PairingOffer {
  /** The daemon's persistent Curve25519 public key, base64-encoded exactly as carried in `offer=`. */
  publicKeyB64: string;
  /** The same key decoded to raw bytes, ready for `createClientChannel({ daemonPublicKey })`. */
  publicKey: Uint8Array;
  /** Optional direct host hint (`host=`), if the pairing link included one. Mutually exclusive with `relay`. */
  host?: string;
  /** Relay endpoint (`relay=`) + TLS flag (`relayTls=`), if the pairing link routes through a relay. */
  relay?: { endpoint: string; useTls: boolean };
}

/**
 * Parse a pairing URL's fragment for the `offer` (daemon public key) and either a direct `host`
 * hint or `relay`/`relayTls` relay-routing info. Accepts either a full URL
 * (`https://app.pi-studio.sh/#offer=...`) or a bare fragment (`#offer=...` / `offer=...`). Returns
 * `null` if no `offer` parameter is present — the caller must treat that as "not a valid pairing
 * link", never fall back to an unauthenticated connection.
 */
export function parsePairingUrl(input: string): PairingOffer | null {
  const hashIndex = input.indexOf("#");
  const fragment = hashIndex === -1 ? input : input.slice(hashIndex + 1);
  const params = new URLSearchParams(fragment);
  const publicKeyB64 = params.get("offer");
  if (!publicKeyB64) return null;

  let publicKey: Uint8Array;
  try {
    publicKey = decodeBase64(publicKeyB64);
  } catch {
    return null;
  }

  const relayEndpoint = params.get("relay");
  if (relayEndpoint) {
    const relay = { endpoint: relayEndpoint, useTls: params.get("relayTls") === "1" };
    return { publicKeyB64, publicKey, relay };
  }

  const host = params.get("host") ?? undefined;
  return { publicKeyB64, publicKey, ...(host ? { host } : {}) };
}
