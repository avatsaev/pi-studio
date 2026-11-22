//! The relay's rendezvous label for a daemon (`packages/relay/src/session-id.ts`).

use sha2::{Digest, Sha512};

use crate::channel::KEY_LENGTH;

/// How many bytes of the digest the id keeps: 16 bytes, 32 hex characters.
const SESSION_ID_BYTES: usize = 16;

/// The session id of the daemon whose long-lived public key is `daemon_key`: the lowercase hex of the
/// first 16 bytes of its SHA-512. Both ends compute it from the pairing link, so it needs no secret.
#[must_use]
pub fn session_id(daemon_key: &[u8; KEY_LENGTH]) -> String {
    let digest = Sha512::digest(daemon_key);
    let mut id = String::with_capacity(2 * SESSION_ID_BYTES);
    for byte in digest.iter().take(SESSION_ID_BYTES) {
        id.extend([byte >> 4, byte & 0x0f].into_iter().filter_map(|nibble| char::from_digit(u32::from(nibble), 16)));
    }
    id
}
