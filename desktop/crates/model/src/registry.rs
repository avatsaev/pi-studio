//! The daemon registry: the `daemons.json` document, its rules as pure operations, the
//! secret-free view and the local daemon's state. Pure data: ids are supplied by the caller.

use std::collections::HashSet;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{DecodeError, EntryId, LOCAL_ENTRY, VERSION, decode, encode};

/// Name given to the `local` entry when it is created.
pub const LOCAL_NAME: &str = "This machine";
/// Longest entry name, in characters, after trimming.
pub const MAX_NAME_CHARS: usize = 64;
/// Longest address, in characters.
pub const MAX_ADDRESS_CHARS: usize = 2048;
/// Longest password, in characters.
pub const MAX_PASSWORD_CHARS: usize = 1024;
/// Longest pairing link, in characters.
pub const MAX_LINK_CHARS: usize = 4096;
/// Most entries in one registry.
pub const MAX_ENTRIES: usize = 64;

/// A secret string. Its debug output is a placeholder; it serializes as the plain string.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Secret {
        Secret(value.into())
    }

    /// The secret itself, for the one place that must hand it on (`resolveCurrent`).
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<secret>")
    }
}

/// What an entry connects to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Local,
    Direct,
    Relay,
}

/// One registry entry. Which optional fields are present depends on `kind`:
/// `local` has `password?`, `direct` has `address` and `password?`, `relay` has `pairing_link`.
/// Unknown fields are kept and written back.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: EntryId,
    pub kind: Kind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<Secret>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pairing_link: Option<Secret>,
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

impl fmt::Debug for Entry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Entry")
            .field("id", &self.id.as_str())
            .field("kind", &self.kind)
            .field("name", &self.name)
            .field("address", &self.address)
            .field("password", &self.password.as_ref().map(|_| "<secret>"))
            .field("pairing_link", &self.pairing_link.as_ref().map(|_| "<secret>"))
            .finish_non_exhaustive()
    }
}

impl Entry {
    fn local() -> Entry {
        Entry { id: EntryId::local(), kind: Kind::Local, name: LOCAL_NAME.to_owned(), address: None, password: None, pairing_link: None, unknown: Map::new() }
    }

    /// The entry without its secrets.
    pub fn view(&self) -> EntryView {
        EntryView {
            id: self.id.as_str().to_owned(),
            kind: self.kind,
            name: self.name.clone(),
            address: self.address.clone(),
            has_password: self.password.is_some(),
        }
    }

    /// Whether the fields present match the kind and the id matches the kind.
    fn consistent(&self) -> bool {
        let id_ok = (self.kind == Kind::Local) == (self.id.as_str() == LOCAL_ENTRY);
        let fields_ok = match self.kind {
            Kind::Local => self.address.is_none() && self.pairing_link.is_none(),
            Kind::Direct => self.address.is_some() && self.pairing_link.is_none(),
            Kind::Relay => self.address.is_none() && self.pairing_link.is_some() && self.password.is_none(),
        };
        id_ok && fields_ok
    }
}

/// An entry without its secrets, as sent to the webview, the menu and the control socket.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryView {
    pub id: String,
    pub kind: Kind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    pub has_password: bool,
}

/// The `daemons.json` document. Unknown fields are kept and written back.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub version: u32,
    #[serde(default)]
    pub last_used_id: Option<EntryId>,
    pub entries: Vec<Entry>,
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

impl Default for Registry {
    fn default() -> Self {
        Registry { version: VERSION, last_used_id: None, entries: vec![Entry::local()], unknown: Map::new() }
    }
}

/// Why an operation was refused. [`RegistryError::code`] is the wire code.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum RegistryError {
    #[error("the name must be 1 to 64 characters")]
    InvalidName,
    #[error("another entry has this name")]
    NameTaken,
    #[error("the address must be 1 to 2048 characters")]
    InvalidAddress,
    #[error("the pairing link must be 1 to 4096 characters")]
    InvalidLink,
    #[error("the password must be 1 to 1024 characters")]
    InvalidPassword,
    #[error("the id is not a new entry id")]
    InvalidId,
    #[error("at most 64 entries")]
    TooMany,
    #[error("no such entry")]
    NotFound,
    #[error("the entry's kind does not have that field")]
    WrongKind,
    #[error("the local entry cannot be removed")]
    LocalNotRemovable,
}

impl RegistryError {
    pub fn code(self) -> &'static str {
        match self {
            RegistryError::InvalidName => "invalid_name",
            RegistryError::NameTaken => "name_taken",
            RegistryError::InvalidAddress => "invalid_address",
            RegistryError::InvalidLink => "invalid_link",
            RegistryError::InvalidPassword => "invalid_password",
            RegistryError::InvalidId => "invalid_id",
            RegistryError::TooMany => "too_many",
            RegistryError::NotFound => "not_found",
            RegistryError::WrongKind => "wrong_kind",
            RegistryError::LocalNotRemovable => "local_not_removable",
        }
    }
}

/// A new entry. Its id is generated by the caller.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NewEntry {
    Direct { name: String, address: String, password: Option<Secret> },
    Relay { name: String, pairing_link: Secret },
}

/// A change to an entry. `None` leaves a field unchanged; `password: Some(None)` clears it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Update {
    pub name: Option<String>,
    pub address: Option<String>,
    pub password: Option<Option<Secret>>,
    pub pairing_link: Option<Secret>,
}

fn chars_in(s: &str, max: usize) -> bool {
    let n = s.chars().count();
    (1..=max).contains(&n)
}

fn check_password(p: &Secret) -> Result<(), RegistryError> {
    if chars_in(p.expose(), MAX_PASSWORD_CHARS) { Ok(()) } else { Err(RegistryError::InvalidPassword) }
}

fn check_address(a: &str) -> Result<(), RegistryError> {
    if chars_in(a, MAX_ADDRESS_CHARS) { Ok(()) } else { Err(RegistryError::InvalidAddress) }
}

fn check_link(l: &Secret) -> Result<(), RegistryError> {
    if chars_in(l.expose(), MAX_LINK_CHARS) { Ok(()) } else { Err(RegistryError::InvalidLink) }
}

impl Registry {
    fn valid(&self) -> bool {
        let mut ids = HashSet::new();
        self.entries.iter().all(|e| e.consistent() && ids.insert(e.id.as_str())) && self.entries.iter().filter(|e| e.kind == Kind::Local).count() <= 1
    }

    /// Creates the `local` entry when missing and drops a `lastUsedId` that names no entry.
    fn normalise(mut self) -> Registry {
        if !self.entries.iter().any(|e| e.kind == Kind::Local) {
            self.entries.insert(0, Entry::local());
        }
        if let Some(id) = &self.last_used_id
            && self.get(id.as_str()).is_none()
        {
            self.last_used_id = None;
        }
        self
    }

    pub fn get(&self, id: &str) -> Option<&Entry> {
        self.entries.iter().find(|e| e.id.as_str() == id)
    }

    /// Every entry without its secrets, in order.
    pub fn views(&self) -> Vec<EntryView> {
        self.entries.iter().map(Entry::view).collect()
    }

    /// A trimmed name that is 1–64 characters and not used by another entry (case-insensitive).
    fn check_name(&self, name: &str, own: Option<&str>) -> Result<String, RegistryError> {
        let name = name.trim();
        if !chars_in(name, MAX_NAME_CHARS) {
            return Err(RegistryError::InvalidName);
        }
        let lower = name.to_lowercase();
        let taken = self.entries.iter().any(|e| Some(e.id.as_str()) != own && e.name.to_lowercase() == lower);
        if taken { Err(RegistryError::NameTaken) } else { Ok(name.to_owned()) }
    }

    /// Adds an entry under `id` (a fresh UUID, never `local`).
    pub fn add(&self, id: EntryId, new: NewEntry) -> Result<Registry, RegistryError> {
        if id.as_str() == LOCAL_ENTRY || self.get(id.as_str()).is_some() {
            return Err(RegistryError::InvalidId);
        }
        let (kind, name, address, password, pairing_link) = match new {
            NewEntry::Direct { name, address, password } => (Kind::Direct, name, Some(address), password, None),
            NewEntry::Relay { name, pairing_link } => (Kind::Relay, name, None, None, Some(pairing_link)),
        };
        let name = self.check_name(&name, None)?;
        if let Some(a) = &address {
            check_address(a)?;
        }
        if let Some(p) = &password {
            check_password(p)?;
        }
        if let Some(l) = &pairing_link {
            check_link(l)?;
        }
        if self.entries.len() >= MAX_ENTRIES {
            return Err(RegistryError::TooMany);
        }
        let mut next = self.clone();
        next.entries.push(Entry { id, kind, name, address, password, pairing_link, unknown: Map::new() });
        Ok(next)
    }

    /// Applies `update` to the entry `id`; nothing changes unless every field is accepted.
    pub fn update(&self, id: &str, update: Update) -> Result<Registry, RegistryError> {
        let entry = self.get(id).ok_or(RegistryError::NotFound)?;
        let has_address = entry.kind == Kind::Direct;
        let has_password = entry.kind != Kind::Relay;
        let has_link = entry.kind == Kind::Relay;
        if (update.address.is_some() && !has_address) || (update.password.is_some() && !has_password) || (update.pairing_link.is_some() && !has_link) {
            return Err(RegistryError::WrongKind);
        }
        let name = update.name.as_deref().map(|n| self.check_name(n, Some(id))).transpose()?;
        if let Some(a) = &update.address {
            check_address(a)?;
        }
        if let Some(Some(p)) = &update.password {
            check_password(p)?;
        }
        if let Some(l) = &update.pairing_link {
            check_link(l)?;
        }
        let mut next = self.clone();
        if let Some(e) = next.entries.iter_mut().find(|e| e.id.as_str() == id) {
            if let Some(name) = name {
                e.name = name;
            }
            if let Some(a) = update.address {
                e.address = Some(a);
            }
            if let Some(p) = update.password {
                e.password = p;
            }
            if let Some(l) = update.pairing_link {
                e.pairing_link = Some(l);
            }
        }
        Ok(next)
    }

    /// Removes an entry; `lastUsedId` becomes null when it named the removed entry.
    pub fn remove(&self, id: &str) -> Result<Registry, RegistryError> {
        if id == LOCAL_ENTRY {
            return Err(RegistryError::LocalNotRemovable);
        }
        if self.get(id).is_none() {
            return Err(RegistryError::NotFound);
        }
        let mut next = self.clone();
        next.entries.retain(|e| e.id.as_str() != id);
        if next.last_used_id.as_ref().is_some_and(|l| l.as_str() == id) {
            next.last_used_id = None;
        }
        Ok(next)
    }

    pub fn set_last_used(&self, id: &str) -> Result<Registry, RegistryError> {
        let entry = self.get(id).ok_or(RegistryError::NotFound)?;
        let mut next = self.clone();
        next.last_used_id = Some(entry.id.clone());
        Ok(next)
    }
}

/// Decodes `daemons.json`. A missing `local` entry is created and a `lastUsedId` that names no
/// entry becomes null; two `local` entries, a repeated id or an entry whose fields do not match
/// its kind make the document `WrongShape`.
pub fn decode_registry(bytes: &[u8]) -> Result<Registry, DecodeError> {
    decode(bytes, Registry::valid).map(Registry::normalise)
}

pub fn encode_registry(registry: &Registry) -> Vec<u8> {
    encode(registry)
}

/// Why a local daemon action failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailReason {
    NotHealthy,
    Timeout,
    BadOutput,
    SpawnFailed,
}

/// The local daemon's state. JSON form: `{ "state": "...", ... }`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum LocalState {
    Unsupported,
    CliMissing {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
    CliOutdated {
        version: String,
    },
    Checking,
    Stopped,
    Starting,
    Stopping,
    Running {
        host: String,
        port: u16,
    },
    Failed {
        reason: FailReason,
    },
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const A: &str = "123e4567-e89b-12d3-a456-426614174000";
    const B: &str = "123e4567-e89b-12d3-a456-426614174001";

    fn id(s: &str) -> EntryId {
        EntryId::parse(s).unwrap()
    }

    fn direct(name: &str) -> NewEntry {
        NewEntry::Direct { name: name.into(), address: "host:1".into(), password: None }
    }

    fn with_work() -> Registry {
        Registry::default().add(id(A), direct("work")).unwrap()
    }

    #[test]
    fn local_is_created_and_duplicated_is_wrong_shape() {
        let r = decode_registry(br#"{"version":1,"entries":[]}"#).unwrap();
        assert_eq!(r.entries.len(), 1);
        assert_eq!(r.entries[0].name, LOCAL_NAME);
        let two = json!({"version":1,"entries":[
            {"id":"local","kind":"local","name":"a"},{"id":"local","kind":"local","name":"b"}]});
        assert_eq!(decode_registry(two.to_string().as_bytes()), Err(DecodeError::WrongShape));
        let dup = json!({"version":1,"entries":[
            {"id":A,"kind":"direct","name":"a","address":"x"},{"id":A,"kind":"direct","name":"b","address":"x"}]});
        assert_eq!(decode_registry(dup.to_string().as_bytes()), Err(DecodeError::WrongShape));
        assert_eq!(decode_registry(br#"{"version":2,"entries":[]}"#), Err(DecodeError::UnknownVersion));
        assert_eq!(decode_registry(b"x"), Err(DecodeError::NotJson));
        let bad_kind = json!({"version":1,"entries":[{"id":A,"kind":"direct","name":"a"}]});
        assert_eq!(decode_registry(bad_kind.to_string().as_bytes()), Err(DecodeError::WrongShape));
    }

    #[test]
    fn dangling_last_used_becomes_null() {
        let src = json!({"version":1,"lastUsedId":A,"entries":[]});
        assert_eq!(decode_registry(src.to_string().as_bytes()).unwrap().last_used_id, None);
        let src = json!({"version":1,"lastUsedId":"local","entries":[]});
        assert_eq!(decode_registry(src.to_string().as_bytes()).unwrap().last_used_id, Some(EntryId::local()));
    }

    #[test]
    fn names() {
        let r = with_work();
        assert_eq!(r.add(id(B), direct("Work")).unwrap_err(), RegistryError::NameTaken);
        assert_eq!(r.add(id(B), direct("this MACHINE")).unwrap_err(), RegistryError::NameTaken);
        let renamed = r.update(A, Update { name: Some("Work".into()), ..Update::default() }).unwrap();
        assert_eq!(renamed.get(A).unwrap().name, "Work");
        assert_eq!(r.add(id(B), direct("   ")).unwrap_err(), RegistryError::InvalidName);
        assert_eq!(r.add(id(B), direct(&"n".repeat(65))).unwrap_err(), RegistryError::InvalidName);
        assert!(r.add(id(B), direct(&"n".repeat(64))).is_ok());
        assert_eq!(r.add(id(B), direct("  trimmed ")).unwrap().get(B).unwrap().name, "trimmed");
        let other = r.add(id(B), direct("home")).unwrap();
        assert_eq!(other.update(B, Update { name: Some("WORK".into()), ..Update::default() }).unwrap_err(), RegistryError::NameTaken);
    }

    #[test]
    fn sizes_and_limit() {
        let r = Registry::default();
        let d = |address: String, password: Option<&str>| NewEntry::Direct { name: "n".into(), address, password: password.map(Secret::new) };
        assert_eq!(r.add(id(A), d("a".repeat(2049), None)).unwrap_err(), RegistryError::InvalidAddress);
        assert!(r.add(id(A), d("a".repeat(2048), None)).is_ok());
        assert_eq!(r.add(id(A), d(String::new(), None)).unwrap_err(), RegistryError::InvalidAddress);
        assert_eq!(r.add(id(A), d("a".into(), Some(""))).unwrap_err(), RegistryError::InvalidPassword);
        assert_eq!(r.add(id(A), d("a".into(), Some(&"p".repeat(1025)))).unwrap_err(), RegistryError::InvalidPassword);
        assert!(r.add(id(A), d("a".into(), Some(&"p".repeat(1024)))).is_ok());
        let relay = |l: String| NewEntry::Relay { name: "n".into(), pairing_link: Secret::new(l) };
        assert_eq!(r.add(id(A), relay("l".repeat(4097))).unwrap_err(), RegistryError::InvalidLink);
        assert_eq!(r.add(id(A), relay(String::new())).unwrap_err(), RegistryError::InvalidLink);
        assert!(r.add(id(A), relay("l".repeat(4096))).is_ok());
        let mut full = r;
        for i in 1..MAX_ENTRIES {
            full = full.add(id(&format!("123e4567-e89b-12d3-a456-{i:012x}")), direct(&format!("e{i}"))).unwrap();
        }
        assert_eq!(full.entries.len(), MAX_ENTRIES);
        assert_eq!(full.add(id(A), direct("extra")).unwrap_err(), RegistryError::TooMany);
        assert_eq!(Registry::default().add(id(A), direct("a")).unwrap().add(id(A), direct("b")).unwrap_err(), RegistryError::InvalidId);
        assert_eq!(Registry::default().add(EntryId::local(), direct("a")).unwrap_err(), RegistryError::InvalidId);
    }

    #[test]
    fn update_rules() {
        let relay = Registry::default().add(id(B), NewEntry::Relay { name: "r".into(), pairing_link: Secret::new("l") }).unwrap();
        let r = with_work();
        assert_eq!(relay.update(B, Update { address: Some("x".into()), ..Update::default() }).unwrap_err(), RegistryError::WrongKind);
        assert_eq!(relay.update(B, Update { password: Some(None), ..Update::default() }).unwrap_err(), RegistryError::WrongKind);
        assert_eq!(r.update(A, Update { pairing_link: Some(Secret::new("l")), ..Update::default() }).unwrap_err(), RegistryError::WrongKind);
        assert_eq!(r.update("local", Update { address: Some("x".into()), ..Update::default() }).unwrap_err(), RegistryError::WrongKind);
        assert_eq!(r.update(B, Update::default()).unwrap_err(), RegistryError::NotFound);
        let set = r.update(A, Update { password: Some(Some(Secret::new("pw"))), address: Some("h:2".into()), ..Update::default() }).unwrap();
        assert!(set.get(A).unwrap().view().has_password);
        assert_eq!(set.get(A).unwrap().address.as_deref(), Some("h:2"));
        let cleared = set.update(A, Update { password: Some(None), ..Update::default() }).unwrap();
        assert!(!cleared.get(A).unwrap().view().has_password);
        assert_eq!(set.update(A, Update { password: Some(Some(Secret::new(""))), ..Update::default() }).unwrap_err(), RegistryError::InvalidPassword);
        assert_eq!(set.update(A, Update::default()).unwrap(), set);
        // a refused update changes nothing, even when an earlier field was fine
        assert!(r.update(A, Update { name: Some("ok".into()), address: Some(String::new()), ..Update::default() }).is_err());
        let relinked = relay.update(B, Update { pairing_link: Some(Secret::new("m")), ..Update::default() }).unwrap();
        assert_eq!(relinked.get(B).unwrap().pairing_link.as_ref().unwrap().expose(), "m");
        let local = r.update("local", Update { password: Some(Some(Secret::new("p"))), name: Some("Me".into()), ..Update::default() }).unwrap();
        assert_eq!(local.get("local").unwrap().name, "Me");
    }

    #[test]
    fn remove_and_last_used() {
        let r = with_work();
        assert_eq!(r.remove("local").unwrap_err(), RegistryError::LocalNotRemovable);
        assert_eq!(r.remove(B).unwrap_err(), RegistryError::NotFound);
        assert_eq!(r.set_last_used(B).unwrap_err(), RegistryError::NotFound);
        let used = r.set_last_used(A).unwrap();
        assert_eq!(used.last_used_id, Some(id(A)));
        let gone = used.remove(A).unwrap();
        assert_eq!(gone.last_used_id, None);
        assert!(gone.get(A).is_none());
        let kept = used.set_last_used("local").unwrap().remove(A).unwrap();
        assert_eq!(kept.last_used_id, Some(EntryId::local()));
    }

    #[test]
    fn secrets_stay_out_of_views_and_debug() {
        let r = Registry::default()
            .add(id(A), NewEntry::Direct { name: "d".into(), address: "h:1".into(), password: Some(Secret::new("hunter2")) })
            .unwrap()
            .add(id(B), NewEntry::Relay { name: "r".into(), pairing_link: Secret::new("pi://secret-link") })
            .unwrap();
        let view = r.get(A).unwrap().view();
        assert!(view.has_password);
        let json = serde_json::to_string(&view).unwrap();
        assert!(!json.contains("hunter2") && !json.contains("password\""));
        assert_eq!(serde_json::to_value(&view).unwrap(), json!({"id":A,"kind":"direct","name":"d","address":"h:1","hasPassword":true}));
        let relay_view = serde_json::to_value(r.get(B).unwrap().view()).unwrap();
        assert_eq!(relay_view, json!({"id":B,"kind":"relay","name":"r","hasPassword":false}));
        let dbg = format!("{r:?} {:?}", r.get(A).unwrap());
        assert!(!dbg.contains("hunter2") && !dbg.contains("secret-link"));
        assert_eq!(format!("{:?}", Secret::new("x")), "<secret>");
    }

    #[test]
    fn unknown_fields_survive() {
        let src = json!({"version":1,"lastUsedId":null,"future":{"a":1},"entries":[
            {"id":"local","kind":"local","name":"m","extra":[1]},
            {"id":A,"kind":"direct","name":"d","address":"h","password":"p","note":true}]});
        let r = decode_registry(src.to_string().as_bytes()).unwrap();
        let back: Value = serde_json::from_slice(&encode_registry(&r)).unwrap();
        assert_eq!(back["future"], json!({"a":1}));
        assert_eq!(back["entries"][0]["extra"], json!([1]));
        assert_eq!(back["entries"][1]["note"], json!(true));
        assert_eq!(back["entries"][1]["password"], json!("p"));
        let after = r.update(A, Update { name: Some("e".into()), ..Update::default() }).unwrap();
        assert_eq!(after.get(A).unwrap().unknown["note"], json!(true));
        assert_eq!(decode_registry(&encode_registry(&r)).unwrap(), r);
    }

    #[test]
    fn local_state_json() {
        let cases = [
            (LocalState::Unsupported, json!({"state":"unsupported"})),
            (LocalState::CliMissing { path: None }, json!({"state":"cli_missing"})),
            (LocalState::CliMissing { path: Some("/x".into()) }, json!({"state":"cli_missing","path":"/x"})),
            (LocalState::CliOutdated { version: "0.0.118".into() }, json!({"state":"cli_outdated","version":"0.0.118"})),
            (LocalState::Checking, json!({"state":"checking"})),
            (LocalState::Stopped, json!({"state":"stopped"})),
            (LocalState::Starting, json!({"state":"starting"})),
            (LocalState::Stopping, json!({"state":"stopping"})),
            (LocalState::Running { host: "127.0.0.1".into(), port: 7777 }, json!({"state":"running","host":"127.0.0.1","port":7777})),
            (LocalState::Failed { reason: FailReason::NotHealthy }, json!({"state":"failed","reason":"not_healthy"})),
            (LocalState::Failed { reason: FailReason::Timeout }, json!({"state":"failed","reason":"timeout"})),
            (LocalState::Failed { reason: FailReason::BadOutput }, json!({"state":"failed","reason":"bad_output"})),
            (LocalState::Failed { reason: FailReason::SpawnFailed }, json!({"state":"failed","reason":"spawn_failed"})),
        ];
        for (state, value) in cases {
            assert_eq!(serde_json::to_value(&state).unwrap(), value);
            assert_eq!(serde_json::from_value::<LocalState>(value).unwrap(), state);
        }
    }

    #[test]
    fn error_codes() {
        assert_eq!(RegistryError::LocalNotRemovable.code(), "local_not_removable");
        assert_eq!(RegistryError::TooMany.code(), "too_many");
    }
}
