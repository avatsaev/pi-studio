import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pairing helpers (architecture/relay-e2ee.md § Pairing). The daemon's persistent Curve25519 public
 * key is carried to clients in a **pairing URL** rendered as a QR code. The key rides in the URL
 * fragment, so the web origin (`app.pi-studio.sh`) never sees it.
 */

export const DEFAULT_PAIRING_BASE = "https://app.pi-studio.sh";

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

/**
 * Build the pairing URL. The public key (and optional direct host) ride in the **fragment**, never
 * sent to the server. TODO(verify): exact bytes/encoding of the `offer` fragment.
 */
export function buildPairingUrl(
  publicKeyB64: string,
  opts: { baseUrl?: string; host?: string } = {},
): string {
  const base = opts.baseUrl ?? DEFAULT_PAIRING_BASE;
  const params = new URLSearchParams({ offer: publicKeyB64 });
  if (opts.host) params.set("host", opts.host);
  return `${base}/#${params.toString()}`;
}
