//! The desktop app's own data as plain, validated types with JSON codecs: the settings, one
//! daemon entry's stored state, the rule that says where a workbench storage key lives, and the
//! address rule (a stored address to the URL the workbench opens).
//! Pure data: no file access, no clock, no randomness.
#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

mod address_rule;
pub mod pairing;
mod registry;

pub use address_rule::{address_matches, normalize_daemon_url};
pub use registry::{
    DEFAULT_DAEMON_PORT, EntryV3, EntryView, FailReason, Kind, LocalState, MAX_ADDRESS_CHARS, MAX_ENTRIES, MAX_HOST_CHARS, MAX_IDENTITY_FILE_CHARS,
    MAX_JUMP_CHARS, MAX_LINK_CHARS, MAX_NAME_CHARS, MAX_PASSWORD_CHARS, MAX_USER_CHARS, MigratedSecret, NewEntry, REGISTRY_V3, RegistryError, RegistryV3,
    RemoteFailReason, RemoteState, Secret, SshFields, SshView, Update, check_host, check_identity_file, check_jump, check_link, check_password, check_port,
    check_user, decode_registry_any, decode_registry_v3, encode_registry_v3,
};

use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Schema version of both documents.
pub const VERSION: u32 = 1;
/// Longest stored value, in bytes.
pub const MAX_VALUE_BYTES: usize = 4 * 1024 * 1024;
/// Longest key, in bytes (a key is at least one byte).
pub const MAX_KEY_BYTES: usize = 256;
/// Most keys in one scope.
pub const MAX_KEYS: usize = 256;
/// Most bytes of values in one scope.
pub const MAX_SCOPE_BYTES: usize = 16 * 1024 * 1024;
/// Longest `cliPath`, in characters.
pub const MAX_CLI_PATH_CHARS: usize = 4096;
/// The one workbench key that is shared by every daemon entry.
pub const GLOBAL_KEY: &str = "pi-studio-appearance";
/// The id of the local daemon's entry.
pub const LOCAL_ENTRY: &str = "local";

/// Why a document could not be decoded.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DecodeError {
    #[error("not valid JSON")]
    NotJson,
    #[error("JSON has the wrong shape")]
    WrongShape,
    #[error("unknown document version")]
    UnknownVersion,
}

/// A storage cap that a write would break.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum LimitError {
    #[error("key must be 1..={MAX_KEY_BYTES} bytes")]
    KeyLength,
    #[error("value is larger than {MAX_VALUE_BYTES} bytes")]
    ValueTooLarge,
    #[error("more than {MAX_KEYS} keys")]
    TooManyKeys,
    #[error("values total more than {MAX_SCOPE_BYTES} bytes")]
    ScopeTooLarge,
}

/// Why a setting could not be changed.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum SettingError {
    #[error("unknown setting `{0}`")]
    UnknownKey(String),
    #[error("wrong type for setting `{0}`")]
    WrongType(String),
    #[error("cliPath is longer than {MAX_CLI_PATH_CHARS} characters")]
    CliPathTooLong,
}

/// Where a workbench storage key is kept.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    /// In the settings file, shared by every daemon entry.
    Global,
    /// In the current daemon entry's state file.
    Entry,
}

/// `pi-studio-appearance` is global; every other key belongs to the current daemon entry.
pub fn scope_of(key: &str) -> Scope {
    if key == GLOBAL_KEY { Scope::Global } else { Scope::Entry }
}

/// Checks that storing `value` under `key` in `scope` (which replaces any existing value of that
/// key) keeps every cap.
pub fn check_put(scope: &BTreeMap<String, String>, key: &str, value: &str) -> Result<(), LimitError> {
    if key.is_empty() || key.len() > MAX_KEY_BYTES {
        return Err(LimitError::KeyLength);
    }
    if value.len() > MAX_VALUE_BYTES {
        return Err(LimitError::ValueTooLarge);
    }
    let replaced = scope.get(key);
    if replaced.is_none() && scope.len() >= MAX_KEYS {
        return Err(LimitError::TooManyKeys);
    }
    let others: usize = scope.iter().filter(|(k, _)| k.as_str() != key).map(|(_, v)| v.len()).sum();
    if others + value.len() > MAX_SCOPE_BYTES {
        return Err(LimitError::ScopeTooLarge);
    }
    Ok(())
}

/// Checks a whole scope against every cap.
pub fn check_scope(scope: &BTreeMap<String, String>) -> Result<(), LimitError> {
    if scope.len() > MAX_KEYS {
        return Err(LimitError::TooManyKeys);
    }
    let mut total = 0usize;
    for (k, v) in scope {
        if k.is_empty() || k.len() > MAX_KEY_BYTES {
            return Err(LimitError::KeyLength);
        }
        if v.len() > MAX_VALUE_BYTES {
            return Err(LimitError::ValueTooLarge);
        }
        total += v.len();
    }
    if total > MAX_SCOPE_BYTES {
        return Err(LimitError::ScopeTooLarge);
    }
    Ok(())
}

/// The app's settings. Unknown fields are kept and written back.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    #[serde(default = "default_true")]
    pub auto_start_local_daemon: bool,
    /// Whether the app looks for a newer build by itself (at launch, daily, after a wake).
    /// "Check for Updates…" works either way. Absent reads as `true`.
    #[serde(default = "default_true")]
    pub check_for_updates: bool,
    #[serde(default)]
    pub cli_path: Option<String>,
    /// The workbench's global keys.
    #[serde(default)]
    pub workbench: BTreeMap<String, String>,
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Settings { version: VERSION, auto_start_local_daemon: true, check_for_updates: true, cli_path: None, workbench: BTreeMap::new(), unknown: Map::new() }
    }
}

impl Settings {
    /// Sets one setting by name (`settings.set`). On error nothing changes.
    pub fn set(&mut self, name: &str, value: &Value) -> Result<(), SettingError> {
        match name {
            "autoStartLocalDaemon" => {
                self.auto_start_local_daemon = value.as_bool().ok_or_else(|| SettingError::WrongType(name.to_owned()))?;
            }
            "checkForUpdates" => {
                self.check_for_updates = value.as_bool().ok_or_else(|| SettingError::WrongType(name.to_owned()))?;
            }
            "cliPath" => {
                let path = match value {
                    Value::Null => None,
                    Value::String(s) => Some(s.clone()),
                    _ => return Err(SettingError::WrongType(name.to_owned())),
                };
                if path.as_ref().is_some_and(|p| p.chars().count() > MAX_CLI_PATH_CHARS) {
                    return Err(SettingError::CliPathTooLong);
                }
                self.cli_path = path;
            }
            _ => return Err(SettingError::UnknownKey(name.to_owned())),
        }
        Ok(())
    }

    fn valid(&self) -> bool {
        self.cli_path.as_ref().is_none_or(|p| p.chars().count() <= MAX_CLI_PATH_CHARS) && check_scope(&self.workbench).is_ok()
    }
}

/// One daemon entry's stored state. Unknown fields are kept and written back.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntryState {
    pub version: u32,
    #[serde(default)]
    pub keys: BTreeMap<String, String>,
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

impl Default for EntryState {
    fn default() -> Self {
        EntryState { version: VERSION, keys: BTreeMap::new(), unknown: Map::new() }
    }
}

impl EntryState {
    fn valid(&self) -> bool {
        check_scope(&self.keys).is_ok()
    }
}

fn decode<T: DeserializeOwned>(bytes: &[u8], valid: fn(&T) -> bool) -> Result<T, DecodeError> {
    decode_at(bytes, VERSION, valid)
}

fn decode_at<T: DeserializeOwned>(bytes: &[u8], version: u32, valid: fn(&T) -> bool) -> Result<T, DecodeError> {
    let json: Value = serde_json::from_slice(bytes).map_err(|_| DecodeError::NotJson)?;
    let Value::Object(object) = &json else { return Err(DecodeError::WrongShape) };
    match object.get("version") {
        Some(v) if v.as_u64() == Some(u64::from(version)) => {}
        Some(v) if v.is_u64() || v.is_i64() => return Err(DecodeError::UnknownVersion),
        _ => return Err(DecodeError::WrongShape),
    }
    let doc: T = serde_json::from_value(json).map_err(|_| DecodeError::WrongShape)?;
    if valid(&doc) { Ok(doc) } else { Err(DecodeError::WrongShape) }
}

fn encode<T: Serialize>(doc: &T) -> Vec<u8> {
    // A map with string keys always serializes; the fallback only keeps the signature total.
    let mut out = serde_json::to_vec_pretty(doc).unwrap_or_else(|_| b"{}".to_vec());
    out.push(b'\n');
    out
}

pub fn decode_settings(bytes: &[u8]) -> Result<Settings, DecodeError> {
    decode(bytes, Settings::valid)
}

pub fn encode_settings(settings: &Settings) -> Vec<u8> {
    encode(settings)
}

pub fn decode_entry_state(bytes: &[u8]) -> Result<EntryState, DecodeError> {
    decode(bytes, EntryState::valid)
}

pub fn encode_entry_state(state: &EntryState) -> Vec<u8> {
    encode(state)
}

/// A daemon entry's id: `local` or a lower-case hyphenated UUID. It becomes a file name, so
/// nothing else is accepted.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct EntryId(String);

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("invalid entry id")]
pub struct EntryIdError;

impl EntryId {
    pub fn parse(s: &str) -> Result<EntryId, EntryIdError> {
        if s == LOCAL_ENTRY || is_uuid(s) { Ok(EntryId(s.to_owned())) } else { Err(EntryIdError) }
    }

    /// The id of the local daemon's entry.
    pub fn local() -> EntryId {
        EntryId(LOCAL_ENTRY.to_owned())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for EntryId {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<EntryId, D::Error> {
        let s = String::deserialize(d)?;
        EntryId::parse(&s).map_err(serde::de::Error::custom)
    }
}

fn is_uuid(s: &str) -> bool {
    let groups: Vec<&str> = s.split('-').collect();
    groups.len() == 5
        && groups.iter().zip([8, 4, 4, 4, 12]).all(|(g, len)| g.len() == len && g.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn defaults_and_unknown_fields_round_trip() {
        let s = decode_settings(br#"{"version":1}"#).unwrap();
        assert_eq!(s, Settings::default());
        assert!(s.check_for_updates, "absent reads as true");
        let off = decode_settings(br#"{"version":1,"checkForUpdates":false,"future":1}"#).unwrap();
        assert!(!off.check_for_updates);
        let back: Value = serde_json::from_slice(&encode_settings(&off)).unwrap();
        assert_eq!((&back["checkForUpdates"], &back["future"]), (&json!(false), &json!(1)));
        let src = br#"{"version":1,"future":{"a":[1]},"workbench":{"k":"v"}}"#;
        let s = decode_settings(src).unwrap();
        let back: Value = serde_json::from_slice(&encode_settings(&s)).unwrap();
        assert_eq!(back["future"], json!({"a":[1]}));
        assert_eq!(back["workbench"], json!({"k":"v"}));
        let e = decode_entry_state(br#"{"version":1,"x":true}"#).unwrap();
        let back: Value = serde_json::from_slice(&encode_entry_state(&e)).unwrap();
        assert_eq!(back, json!({"version":1,"keys":{},"x":true}));
        assert!(encode_entry_state(&e).ends_with(b"}\n"));
    }

    #[test]
    fn decode_errors() {
        assert_eq!(decode_settings(br#"{"version":2}"#), Err(DecodeError::UnknownVersion));
        assert_eq!(decode_settings(b"[]"), Err(DecodeError::WrongShape));
        assert_eq!(decode_settings(b"\xff nope"), Err(DecodeError::NotJson));
        assert_eq!(decode_settings(b"{}"), Err(DecodeError::WrongShape));
        assert_eq!(decode_settings(br#"{"version":1,"autoStartLocalDaemon":"x"}"#), Err(DecodeError::WrongShape));
        assert_eq!(decode_entry_state(br#"{"version":1,"keys":{"a":1}}"#), Err(DecodeError::WrongShape));
        assert_eq!(decode_entry_state(br#"{"version":3}"#), Err(DecodeError::UnknownVersion));
    }

    #[test]
    fn scopes() {
        assert_eq!(scope_of("pi-studio-appearance"), Scope::Global);
        assert_eq!(scope_of("pi-studio-pane-layout"), Scope::Entry);
        assert_eq!(scope_of("pi-studio-agent-todos-ui"), Scope::Entry);
        assert_eq!(scope_of("whatever"), Scope::Entry);
    }

    #[test]
    fn caps() {
        let empty = BTreeMap::new();
        assert_eq!(check_put(&empty, "k", &"a".repeat(MAX_VALUE_BYTES)), Ok(()));
        assert_eq!(check_put(&empty, "k", &"a".repeat(MAX_VALUE_BYTES + 1)), Err(LimitError::ValueTooLarge));
        assert_eq!(check_put(&empty, "", "v"), Err(LimitError::KeyLength));
        assert_eq!(check_put(&empty, &"k".repeat(MAX_KEY_BYTES), "v"), Ok(()));
        assert_eq!(check_put(&empty, &"k".repeat(MAX_KEY_BYTES + 1), "v"), Err(LimitError::KeyLength));
        let full: BTreeMap<String, String> = (0..MAX_KEYS).map(|i| (format!("k{i}"), String::new())).collect();
        assert_eq!(check_put(&full, "new", "v"), Err(LimitError::TooManyKeys));
        assert_eq!(check_put(&full, "k0", "v"), Ok(()));
        let big: BTreeMap<String, String> = (0..4).map(|i| (format!("k{i}"), "a".repeat(MAX_VALUE_BYTES))).collect();
        assert_eq!(check_put(&big, "n", "a"), Err(LimitError::ScopeTooLarge));
        assert_eq!(check_put(&big, "k0", &"a".repeat(MAX_VALUE_BYTES)), Ok(()));
        assert_eq!(check_scope(&big), Ok(()));
    }

    #[test]
    fn entry_ids() {
        assert!(EntryId::parse("local").is_ok());
        assert!(EntryId::parse("123e4567-e89b-12d3-a456-426614174000").is_ok());
        for bad in ["../x", "a/b", "", "LOCAL", "123E4567-E89B-12D3-A456-426614174000", "123e4567-e89b-12d3-a456-42661417400"] {
            assert!(EntryId::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn set_setting() {
        let mut s = Settings::default();
        assert_eq!(s.set("autoStartLocalDaemon", &json!(false)), Ok(()));
        assert_eq!(s.set("checkForUpdates", &json!(false)), Ok(()));
        assert!(!s.check_for_updates);
        assert_eq!(s.set("checkForUpdates", &json!("no")), Err(SettingError::WrongType("checkForUpdates".into())));
        assert!(!s.check_for_updates);
        s.set("checkForUpdates", &json!(true)).unwrap();
        assert!(!s.auto_start_local_daemon);
        assert_eq!(s.set("cliPath", &json!("/bin/pi")), Ok(()));
        assert_eq!(s.set("cliPath", &json!(null)), Ok(()));
        assert_eq!(s.cli_path, None);
        s.set("cliPath", &json!("/x")).unwrap();
        let before = s.clone();
        assert_eq!(s.set("cliPath", &json!("a".repeat(MAX_CLI_PATH_CHARS + 1))), Err(SettingError::CliPathTooLong));
        assert_eq!(s.set("cliPath", &json!(3)), Err(SettingError::WrongType("cliPath".into())));
        assert_eq!(s.set("autoStartLocalDaemon", &json!("yes")), Err(SettingError::WrongType("autoStartLocalDaemon".into())));
        assert_eq!(s.set("nope", &json!(1)), Err(SettingError::UnknownKey("nope".into())));
        assert_eq!(s, before);
        assert_eq!(s.set("cliPath", &json!("a".repeat(MAX_CLI_PATH_CHARS))), Ok(()));
    }
}
