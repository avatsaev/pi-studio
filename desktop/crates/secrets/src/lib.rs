//! The secret store: small secrets (a direct entry's password, a relay entry's pairing link) kept
//! apart from the registry file.
//!
//! [`SecretStore`] is the contract; this crate has the two backends that need no operating-system
//! service: [`FileStore`] (`secrets.json`, mode 0600) and [`MemoryStore`] (nowhere). A secret is a
//! [`Secret`], whose `Debug` and `Display` never show the value, and no error carries one.
//!
//! Secrets are not wiped from memory on drop: that needs `unsafe` or a dependency for little gain
//! here, since the process also holds the same secrets in its registry while it runs.
//!
//! File access is native only: on wasm32 this crate is empty.
#![cfg(not(target_arch = "wasm32"))]

mod file;
mod memory;

use std::fmt;

use pistudiodesktop_model::{EntryId, MAX_LINK_CHARS, MAX_PASSWORD_CHARS};

pub use file::{FILE_NAME, FileStore, Opened, Reset};
pub use memory::MemoryStore;

/// A secret string. `Debug` and `Display` print a placeholder; there is no `Serialize`.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Secret {
        Secret(value.into())
    }

    /// The secret itself, for the one place that must hand it on.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<secret>")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<secret>")
    }
}

/// What a secret is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum SecretKind {
    Password,
    PairingLink,
}

impl SecretKind {
    /// The name used in a store key: `password` or `pairingLink`.
    pub fn as_str(self) -> &'static str {
        match self {
            SecretKind::Password => "password",
            SecretKind::PairingLink => "pairingLink",
        }
    }

    pub fn parse(s: &str) -> Option<SecretKind> {
        match s {
            "password" => Some(SecretKind::Password),
            "pairingLink" => Some(SecretKind::PairingLink),
            _ => None,
        }
    }

    /// The longest secret of this kind, in characters (the registry's cap).
    pub fn max_chars(self) -> usize {
        match self {
            SecretKind::Password => MAX_PASSWORD_CHARS,
            SecretKind::PairingLink => MAX_LINK_CHARS,
        }
    }

    fn describe(self) -> &'static str {
        match self {
            SecretKind::Password => "password",
            SecretKind::PairingLink => "pairing link",
        }
    }
}

/// One secret's address: an entry and what the secret is for.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SecretKey {
    pub entry: EntryId,
    pub kind: SecretKind,
}

impl SecretKey {
    pub fn new(entry: EntryId, kind: SecretKind) -> SecretKey {
        SecretKey { entry, kind }
    }

    /// `<entry id>/<kind>`: the item name in `secrets.json` and the tail of a keychain account.
    pub fn name(&self) -> String {
        format!("{}/{}", self.entry.as_str(), self.kind.as_str())
    }

    /// The inverse of [`SecretKey::name`]; `None` for anything else.
    pub fn parse(name: &str) -> Option<SecretKey> {
        let (entry, kind) = name.split_once('/')?;
        Some(SecretKey { entry: EntryId::parse(entry).ok()?, kind: SecretKind::parse(kind)? })
    }
}

/// Which backend answers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoreKind {
    Keychain,
    File,
    Memory,
}

impl StoreKind {
    /// `keychain`, `file` or `memory`: the value of `secretStore` in the registry view.
    pub fn as_str(self) -> &'static str {
        match self {
            StoreKind::Keychain => "keychain",
            StoreKind::File => "file",
            StoreKind::Memory => "memory",
        }
    }
}

/// Why a store call failed. The text says what was wrong and never holds a secret.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum SecretError {
    /// The store cannot be reached or is locked.
    #[error("the secret store is not available: {0}")]
    Unavailable(String),
    /// The system or the user refused access.
    #[error("access to the secret store was denied: {0}")]
    Denied(String),
    /// Anything else: the call did not take effect.
    #[error("the secret store failed: {0}")]
    Failed(String),
}

impl SecretError {
    /// `unavailable`, `denied` or `failed`.
    pub fn code(&self) -> &'static str {
        match self {
            SecretError::Unavailable(_) => "unavailable",
            SecretError::Denied(_) => "denied",
            SecretError::Failed(_) => "failed",
        }
    }
}

/// The contract of a backend. A call may block (the keychain can wait for the user): callers keep
/// it off the main thread.
pub trait SecretStore: Send + Sync {
    /// Which backend this is.
    fn kind(&self) -> StoreKind;
    /// The secret, or `None` when there is none.
    fn get(&self, key: &SecretKey) -> Result<Option<Secret>, SecretError>;
    /// Store `secret`, replacing any previous one. A secret that is empty or longer than the
    /// registry's cap for its kind is refused and nothing changes.
    fn set(&self, key: &SecretKey, secret: &Secret) -> Result<(), SecretError>;
    /// Remove the secret. Removing one that is absent succeeds.
    fn delete(&self, key: &SecretKey) -> Result<(), SecretError>;
}

/// Refuse what the registry would refuse (1 to the cap, in characters). Shared by every backend so
/// that a value one accepts, another accepts. Reads at most `cap + 1` characters.
pub(crate) fn check_len(kind: SecretKind, secret: &Secret) -> Result<(), SecretError> {
    let max = kind.max_chars();
    let chars = secret.expose().chars().take(max + 1).count();
    if (1..=max).contains(&chars) { Ok(()) } else { Err(SecretError::Failed(format!("a {} must be 1 to {max} characters", kind.describe()))) }
}

/// Lock a mutex; a panic in another holder (which leaves the map consistent: every change is a
/// single insert or remove) does not make the store unusable.
pub(crate) fn lock<T>(m: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARKER: &str = "hunter2-MARKER";

    fn key(kind: SecretKind) -> SecretKey {
        SecretKey::new(EntryId::local(), kind)
    }

    #[test]
    fn a_secret_never_shows_its_value() {
        let s = Secret::new(MARKER);
        for shown in [format!("{s:?}"), format!("{s}"), format!("{s:#?}"), format!("{:?}", Some(&s)), format!("{:?}", key(SecretKind::Password))] {
            assert!(!shown.contains("MARKER"), "{shown}");
        }
        assert_eq!(s.expose(), MARKER);
    }

    #[test]
    fn a_refusal_names_the_limit_and_not_the_value() {
        let long = format!("{MARKER}{}", "x".repeat(MAX_PASSWORD_CHARS));
        let err = check_len(SecretKind::Password, &Secret::new(long)).unwrap_err();
        let shown = format!("{err} {err:?}");
        assert!(!shown.contains("MARKER"), "{shown}");
        assert!(shown.contains("1024"), "{shown}");
        assert_eq!(err.code(), "failed");
    }

    #[test]
    fn the_caps_count_characters_not_bytes() {
        let edge = "é".repeat(MAX_PASSWORD_CHARS);
        assert!(check_len(SecretKind::Password, &Secret::new(edge.clone())).is_ok());
        assert!(check_len(SecretKind::Password, &Secret::new(format!("{edge}é"))).is_err());
        assert!(check_len(SecretKind::PairingLink, &Secret::new("l".repeat(MAX_LINK_CHARS))).is_ok());
        assert!(check_len(SecretKind::PairingLink, &Secret::new("l".repeat(MAX_LINK_CHARS + 1))).is_err());
        assert!(check_len(SecretKind::Password, &Secret::new("")).is_err());
    }

    #[test]
    fn keys_round_trip_through_their_names() {
        let id = EntryId::parse("123e4567-e89b-12d3-a456-426614174000").unwrap();
        for kind in [SecretKind::Password, SecretKind::PairingLink] {
            let k = SecretKey::new(id.clone(), kind);
            assert_eq!(SecretKey::parse(&k.name()), Some(k));
        }
        assert_eq!(key(SecretKind::PairingLink).name(), "local/pairingLink");
        for bad in ["", "local", "local/", "local/token", "../x/password", "local/password/x", "LOCAL/password"] {
            assert_eq!(SecretKey::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn backends_report_their_kind_by_name() {
        assert_eq!([StoreKind::Keychain, StoreKind::File, StoreKind::Memory].map(StoreKind::as_str), ["keychain", "file", "memory"]);
    }
}
