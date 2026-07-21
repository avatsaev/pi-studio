/**
 * Deterministic relay session id derivation (architecture/relay-e2ee.md § Pairing).
 *
 * The relay's rendezvous `sessionId` (the `{ type: "relay_register", sessionId }` frame) must be
 * something both sides can compute independently from data the pairing link already carries — the
 * daemon's persistent public key — so a pairing link keeps working across relay reconnects
 * (each of which previously minted a fresh random session id, silently invalidating any link
 * printed before the next drop).
 *
 * This derivation adds no new secret: the pairing link already carries the daemon's public key
 * and is documented as "the trust anchor, treat it like a password" (relay-e2ee.md § Pairing). A
 * session id computed from that same public value reveals nothing an attacker didn't already have
 * once they held the link. What it changes is durability — the daemon and any pairing-link holder
 * now agree on the same session id forever (until the keypair itself is regenerated), instead of a
 * fresh id being renegotiated implicitly on every reconnect.
 */
import nacl from "tweetnacl";

const SESSION_ID_BYTES = 16; // 32 hex chars — plenty of entropy for a rendezvous label, not a secret.

/** Derive the relay session id for a daemon identified by `publicKey` (its persistent Curve25519 public key). */
export function deriveRelaySessionId(publicKey: Uint8Array): string {
  const digest = nacl.hash(publicKey); // SHA-512, 64 bytes
  let hex = "";
  for (let i = 0; i < SESSION_ID_BYTES; i++) {
    hex += (digest[i] as number).toString(16).padStart(2, "0");
  }
  return hex;
}
