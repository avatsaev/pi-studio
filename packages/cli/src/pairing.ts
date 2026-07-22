import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pairing helpers (architecture/relay-e2ee.md § Pairing). The daemon's persistent Curve25519 public
 * key is carried to clients in a **pairing URL** rendered as a QR code. The key rides in the URL
 * fragment, so the web origin never sees it.
 *
 * When the daemon dials an outbound relay (`daemon.relay.enabled`), the pairing URL ALSO carries
 * the relay's client-facing endpoint (`relay=`) and whether that endpoint speaks TLS (`relayTls=`)
 * — everything a client needs to compute the same rendezvous session id
 * (`deriveRelaySessionId(offer)`, `@av-pi-studio/relay`) and dial the relay directly, without ever
 * needing the daemon's own direct `host:port` to be reachable. `host=` is omitted whenever a relay
 * is present — the two are alternatives, not a preference order, since a relay-only daemon (behind
 * a firewall/NAT) has no reachable direct host to offer.
 */

/**
 * Default pairing-link origin — Pi-Studio's own production web-client (deployed to Dokploy's
 * `molagent-platform` project; `docker/README.md` § Deploying to production). Override via
 * `PI_STUDIO_APP_BASE_URL` (`config.app.baseUrl`) for self-hosted/local deployments, e.g.
 * `http://localhost:8080` — see `daemon-commands.ts`'s `resolvePairingRelayInfo`/`printPairing`.
 */
export const DEFAULT_PAIRING_BASE = "https://app.molagent.ai";

/** Read the daemon's persistent public key (base64) from `$PI_STUDIO_HOME/daemon-keypair.json`. */
export function readDaemonPublicKey(home: string): string | null {
  const path = join(home, "daemon-keypair.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { publicKeyB64?: string };
    return parsed.publicKeyB64 ?? null;
  } catch {
    return null;
  }
}

/** Relay half of a pairing URL — present only when the daemon dials an outbound relay. */
export interface PairingRelayInfo {
  /** The relay's client-facing endpoint (`daemon.relay.publicEndpoint`, falling back to `endpoint`). */
  endpoint: string;
  /** Whether that endpoint speaks TLS (`daemon.relay.publicUseTls`). */
  useTls: boolean;
}

/**
 * Build the pairing URL. The public key (and optional direct host / relay info) ride in the
 * **fragment**, never sent to the server. TODO(verify): exact bytes/encoding of the `offer`
 * fragment.
 */
export function buildPairingUrl(
  publicKeyB64: string,
  opts: { baseUrl?: string; host?: string; relay?: PairingRelayInfo } = {},
): string {
  const base = opts.baseUrl ?? DEFAULT_PAIRING_BASE;
  const params = new URLSearchParams({ offer: publicKeyB64 });
  if (opts.relay) {
    params.set("relay", opts.relay.endpoint);
    params.set("relayTls", opts.relay.useTls ? "1" : "0");
  } else if (opts.host) {
    params.set("host", opts.host);
  }
  return `${base}/#${params.toString()}`;
}
