//! The pairing link: what a relay entry's stored link says about the daemon and the way to it.
//!
//! The link is the SDK's (`parsePairingUrl` in `packages/client/src/pairing.ts`): the text after the
//! first `#` (all of the text when there is none) is read as form-encoded parameters, and `offer` is
//! the daemon's public key in standard base64, padded or not. Rust is stricter in four ways: the key
//! must be exactly 32 bytes, a link has `relay` or `host` and not both and not neither, the relay is
//! reduced to the address to dial, and an address with a blank or control character is refused. The
//! two implementations share their cases in `pairing-link.vectors.json`, beside the SDK's parser:
//! each side's test runs the whole file.

use std::fmt;

use crate::registry::RegistryError;

/// The length of the daemon's public key, in bytes.
pub const DAEMON_KEY_BYTES: usize = 32;

/// Where the link leads.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Target {
    /// Through a relay: the address to dial (`host` or `host:port`, no scheme, no trailing slash) and
    /// whether to use TLS (`relayTls=1`).
    Relay { host: String, tls: bool },
    /// Straight to the daemon, at the link's `host` as written.
    Direct { host: String },
}

/// A parsed pairing link.
#[derive(Clone, PartialEq, Eq)]
pub struct PairingLink {
    /// The daemon's public key, the trust anchor of the connection.
    pub daemon_key: [u8; DAEMON_KEY_BYTES],
    pub target: Target,
}

impl fmt::Debug for PairingLink {
    /// The key is a secret in all but name: only its presence is shown.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PairingLink").field("daemon_key", &"<hidden>").field("target", &self.target).finish()
    }
}

/// The value of a base64 digit of the standard alphabet.
const fn digit(c: u8) -> Option<u32> {
    match c {
        b'A'..=b'Z' => Some((c - b'A') as u32),
        b'a'..=b'z' => Some((c - b'a') as u32 + 26),
        b'0'..=b'9' => Some((c - b'0') as u32 + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// The 32 bytes of a standard base64 string with or without trailing `=`, as the SDK's `decodeBase64`
/// reads it (bits left over at the end are dropped); any other length or character is `None`.
fn decode_key(text: &str) -> Option<[u8; DAEMON_KEY_BYTES]> {
    let mut key = [0u8; DAEMON_KEY_BYTES];
    let mut len = 0;
    let (mut buffer, mut bits) = (0u32, 0u32);
    for c in text.trim_end_matches('=').bytes() {
        buffer = (buffer << 6) | digit(c)?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            *key.get_mut(len)? = u8::try_from((buffer >> bits) & 0xff).ok()?;
            len += 1;
            buffer &= (1 << bits) - 1;
        }
    }
    (len == DAEMON_KEY_BYTES).then_some(key)
}

/// `relay` as the address to dial: a leading `http://`, `https://`, `ws://` or `wss://` (any letter
/// case) and trailing slashes removed. `None` when nothing is left or the rest has a blank or a
/// control character.
fn relay_host(relay: &str) -> Option<String> {
    let rest = relay
        .split_once("://")
        .filter(|(scheme, _)| ["http", "https", "ws", "wss"].iter().any(|s| scheme.eq_ignore_ascii_case(s)))
        .map_or(relay, |(_, rest)| rest);
    clean_host(rest.trim_end_matches('/'))
}

/// `host` when it is something to dial: not empty and with no blank or control character.
fn clean_host(host: &str) -> Option<String> {
    (!host.is_empty() && !host.chars().any(|c| c.is_whitespace() || c.is_control())).then(|| host.to_owned())
}

/// Read a pairing link. Never panics, whatever the input; the error is always
/// [`RegistryError::InvalidLink`] and says nothing of the link.
pub fn parse(link: &str) -> Result<PairingLink, RegistryError> {
    let fragment = link.split_once('#').map_or(link, |(_, fragment)| fragment);
    let (mut offer, mut host, mut relay, mut relay_tls) = (None, None, None, None);
    for (key, value) in form_urlencoded::parse(fragment.as_bytes()) {
        let slot = match key.as_ref() {
            "offer" => &mut offer,
            "host" => &mut host,
            "relay" => &mut relay,
            "relayTls" => &mut relay_tls,
            _ => continue,
        };
        // The first of a repeated parameter wins, as `URLSearchParams.get` has it.
        slot.get_or_insert(value);
    }
    let daemon_key = offer.as_deref().and_then(decode_key).ok_or(RegistryError::InvalidLink)?;
    let host = host.filter(|h| !h.is_empty());
    let relay = relay.filter(|r| !r.is_empty());
    let target = match (host, relay) {
        (Some(host), None) => Target::Direct { host: clean_host(&host).ok_or(RegistryError::InvalidLink)? },
        (None, Some(relay)) => Target::Relay { host: relay_host(&relay).ok_or(RegistryError::InvalidLink)?, tls: relay_tls.as_deref() == Some("1") },
        _ => return Err(RegistryError::InvalidLink),
    };
    Ok(PairingLink { daemon_key, target })
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Vector {
        name: String,
        input: String,
        rust: Option<Expected>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Expected {
        key_hex: String,
        target: ExpectedTarget,
    }

    #[derive(Deserialize)]
    #[serde(tag = "kind", rename_all = "lowercase")]
    enum ExpectedTarget {
        Relay { host: String, tls: bool },
        Direct { host: String },
    }

    /// The vectors the SDK's `pairing.test.ts` runs too.
    fn vectors() -> Vec<Vector> {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../packages/client/src/pairing-link.vectors.json");
        let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read the shared vectors at {path}: {e}"));
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("the shared vectors are not valid: {e}"))
    }

    fn hex(key: &[u8]) -> String {
        key.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn every_shared_vector_parses_as_recorded() {
        let all = vectors();
        assert!(all.len() >= 15, "the shared file looks truncated: {} vectors", all.len());
        for v in &all {
            match (&v.rust, parse(&v.input)) {
                (None, got) => assert_eq!(got, Err(RegistryError::InvalidLink), "{}", v.name),
                (Some(want), Ok(got)) => {
                    assert_eq!(hex(&got.daemon_key), want.key_hex, "{}", v.name);
                    let target = match &want.target {
                        ExpectedTarget::Relay { host, tls } => Target::Relay { host: host.clone(), tls: *tls },
                        ExpectedTarget::Direct { host } => Target::Direct { host: host.clone() },
                    };
                    assert_eq!(got.target, target, "{}", v.name);
                }
                (Some(_), Err(e)) => panic!("{}: refused with {e:?}", v.name),
            }
        }
    }

    #[test]
    fn the_shared_vectors_include_the_key_lengths_the_sdk_accepts() {
        let all = vectors();
        for name in ["31 bytes", "33 bytes"] {
            assert!(all.iter().any(|v| v.name.contains(name) && v.rust.is_none()), "{name}");
        }
    }

    #[test]
    fn debug_hides_the_key() {
        let link = parse("#offer=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&host=h%3A1").unwrap_or_else(|e| panic!("{e:?}"));
        let shown = format!("{link:?}");
        assert!(shown.contains("<hidden>") && shown.contains("h:1"), "{shown}");
        assert!(!shown.contains("31") && !shown.contains("AAEC"), "{shown}");
    }

    #[test]
    fn the_first_of_a_repeated_parameter_wins() {
        let link = parse("#offer=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&host=a&host=b").unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(link.target, Target::Direct { host: "a".to_owned() });
    }

    #[test]
    fn hostile_input_is_refused_without_panicking() {
        let key = "offer=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
        for link in [
            "",
            "#",
            "##",
            "#offer",
            "é#é",
            "#host=%FF&offer=%FF",
            &format!("#{key}&host=a%20b"),
            &format!("#{key}&host=a%0Ab"),
            &format!("#{key}&relay=ws%3A%2F%2F"),
        ] {
            assert_eq!(parse(link), Err(RegistryError::InvalidLink), "{link:?}");
        }
        assert!(parse(&format!("#{key}&relay=WSS%3A%2F%2FR.example")).is_ok());
    }
}
