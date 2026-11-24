//! The daemon registry: the `daemons.json` document (version 3, without secrets), its rules as
//! pure operations, the secret-free view and the local and remote daemons' states. Pure data: ids
//! are supplied by the caller.
//!
//! A secret (a direct, local or SSH entry's daemon password, an SSH entry's account password and key
//! passphrase, a relay entry's pairing link) is never in the document: an entry says `hasPassword`
//! (and `hasSshPassword`, `hasPassphrase`), and the secret is in the secret store. A version 1
//! file, which held the secrets, is only read, to hand them to the store ([`decode_registry_any`]);
//! a version 2 file is read and written back as version 3.

use std::collections::HashSet;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{DecodeError, EntryId, LOCAL_ENTRY, decode, decode_at, encode};

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
/// Longest SSH host, in characters.
pub const MAX_HOST_CHARS: usize = 255;
/// Longest SSH user, in characters.
pub const MAX_USER_CHARS: usize = 64;
/// Longest identity file path, in characters.
pub const MAX_IDENTITY_FILE_CHARS: usize = 4096;
/// Longest jump host list, in characters.
pub const MAX_JUMP_CHARS: usize = 1024;
/// The daemon's port on an SSH host when none is given.
pub const DEFAULT_DAEMON_PORT: u16 = 6767;

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
    Ssh,
}

/// An entry without its secrets, as sent to the webview, the menu and the control socket. For an SSH
/// entry `address` is the display text `[user@]host[:port]` and `ssh` holds the fields.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryView {
    pub id: String,
    pub kind: Kind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    pub has_password: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh: Option<SshView>,
}

/// An SSH entry's fields as the view shows them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshView {
    pub host: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jump: Option<String>,
    pub daemon_port: u16,
    pub has_ssh_password: bool,
    pub has_passphrase: bool,
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
    #[error("the host must be 1 to 255 characters without whitespace")]
    InvalidHost,
    #[error("the user must be 1 to 64 characters")]
    InvalidUser,
    #[error("a port must be 1 to 65535")]
    InvalidPort,
    #[error("the identity file path must be 1 to 4096 characters")]
    InvalidPath,
    #[error("the jump hosts must be 1 to 1024 characters: [user@]host[:port], comma-separated")]
    InvalidJump,
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
            RegistryError::InvalidHost => "invalid_host",
            RegistryError::InvalidUser => "invalid_user",
            RegistryError::InvalidPort => "invalid_port",
            RegistryError::InvalidPath => "invalid_path",
            RegistryError::InvalidJump => "invalid_jump",
        }
    }
}

/// The fields that say where an SSH entry's daemon is. `user`, `port` and `jump` absent mean the
/// `~/.ssh/config` value, else the default.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SshFields {
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    pub jump: Option<String>,
    pub daemon_port: u16,
}

/// A new entry. Its id is generated by the caller. The secrets are not here: they go to the secret
/// store, and the `has_*` flags say that they will be there.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NewEntry {
    Direct {
        name: String,
        address: String,
        has_password: bool,
    },
    /// The pairing link is the entry's one secret and is always in the store.
    Relay {
        name: String,
    },
    Ssh {
        name: String,
        ssh: SshFields,
        has_password: bool,
        has_ssh_password: bool,
        has_passphrase: bool,
    },
}

impl NewEntry {
    fn name(&self) -> &str {
        match self {
            NewEntry::Direct { name, .. } | NewEntry::Relay { name } | NewEntry::Ssh { name, .. } => name,
        }
    }
}

/// A change to an entry. `None` leaves a field unchanged; for the optional SSH fields `Some(None)`
/// clears the field. The secrets are not here (see [`NewEntry`]): the `has_*` fields say whether the
/// entry has that secret afterwards, and `new_link` says a relay entry's pairing link is being
/// replaced.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Update {
    pub name: Option<String>,
    pub address: Option<String>,
    pub has_password: Option<bool>,
    pub new_link: bool,
    pub host: Option<String>,
    pub user: Option<Option<String>>,
    pub port: Option<Option<u16>>,
    pub identity_file: Option<Option<String>>,
    pub jump: Option<Option<String>>,
    pub daemon_port: Option<u16>,
    pub has_ssh_password: Option<bool>,
    pub has_passphrase: Option<bool>,
}

impl Update {
    /// Whether the update touches a field only an SSH entry has.
    fn has_ssh_field(&self) -> bool {
        self.host.is_some()
            || self.user.is_some()
            || self.port.is_some()
            || self.identity_file.is_some()
            || self.jump.is_some()
            || self.daemon_port.is_some()
            || self.has_ssh_password.is_some()
            || self.has_passphrase.is_some()
    }
}

fn chars_in(s: &str, max: usize) -> bool {
    let n = s.chars().take(max + 1).count();
    (1..=max).contains(&n)
}

/// Whether `password` is a password the registry accepts (1 to 1,024 characters).
pub fn check_password(password: &str) -> Result<(), RegistryError> {
    if chars_in(password, MAX_PASSWORD_CHARS) { Ok(()) } else { Err(RegistryError::InvalidPassword) }
}

/// Whether `link` is a pairing link the registry accepts: 1 to 4,096 characters that
/// [`crate::pairing::parse`] reads.
pub fn check_link(link: &str) -> Result<(), RegistryError> {
    if chars_in(link, MAX_LINK_CHARS) { crate::pairing::parse(link).map(drop) } else { Err(RegistryError::InvalidLink) }
}

fn check_address(a: &str) -> Result<(), RegistryError> {
    if chars_in(a, MAX_ADDRESS_CHARS) { Ok(()) } else { Err(RegistryError::InvalidAddress) }
}

fn host_ok(host: &str) -> bool {
    chars_in(host, MAX_HOST_CHARS) && !host.chars().any(char::is_whitespace)
}

/// Whether `host` is an SSH host the registry accepts: 1 to 255 characters, no whitespace.
pub fn check_host(host: &str) -> Result<(), RegistryError> {
    if host_ok(host) { Ok(()) } else { Err(RegistryError::InvalidHost) }
}

/// Whether `user` is an SSH user the registry accepts (1 to 64 characters).
pub fn check_user(user: &str) -> Result<(), RegistryError> {
    if chars_in(user, MAX_USER_CHARS) { Ok(()) } else { Err(RegistryError::InvalidUser) }
}

/// A port number from the wire: 1 to 65535.
pub fn check_port(port: u64) -> Result<u16, RegistryError> {
    match u16::try_from(port) {
        Ok(p) if p != 0 => Ok(p),
        _ => Err(RegistryError::InvalidPort),
    }
}

/// Whether `path` is an identity file path the registry accepts (1 to 4,096 characters).
pub fn check_identity_file(path: &str) -> Result<(), RegistryError> {
    if chars_in(path, MAX_IDENTITY_FILE_CHARS) { Ok(()) } else { Err(RegistryError::InvalidPath) }
}

/// `host[:port]` or `[host]:port` split in two; `None` when a bracket is not closed or something but
/// a port follows it.
fn split_host_port(s: &str) -> Option<(&str, Option<&str>)> {
    if let Some(rest) = s.strip_prefix('[') {
        let (host, tail) = rest.split_once(']')?;
        return if tail.is_empty() { Some((host, None)) } else { Some((host, Some(tail.strip_prefix(':')?))) };
    }
    Some(match s.split_once(':') {
        None => (s, None),
        Some((host, port)) => (host, Some(port)),
    })
}

fn hop_ok(hop: &str) -> bool {
    if hop.chars().any(char::is_whitespace) {
        return false;
    }
    let (user, rest) = match hop.rsplit_once('@') {
        Some((user, rest)) => (Some(user), rest),
        None => (None, hop),
    };
    let Some((host, port)) = split_host_port(rest) else { return false };
    let port_ok = port.is_none_or(|p| p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()) && p.parse::<u64>().is_ok_and(|n| check_port(n).is_ok()));
    user.is_none_or(|u| check_user(u).is_ok()) && host_ok(host) && port_ok
}

/// Whether `jump` is a list the registry accepts: at most 1,024 characters, `[user@]host[:port]`
/// entries separated by commas.
pub fn check_jump(jump: &str) -> Result<(), RegistryError> {
    if chars_in(jump, MAX_JUMP_CHARS) && jump.split(',').all(hop_ok) { Ok(()) } else { Err(RegistryError::InvalidJump) }
}

fn check_ssh(s: &SshFields) -> Result<(), RegistryError> {
    check_host(&s.host)?;
    s.user.as_deref().map(check_user).transpose()?;
    s.port.map(|p| check_port(u64::from(p))).transpose()?;
    s.identity_file.as_deref().map(check_identity_file).transpose()?;
    s.jump.as_deref().map(check_jump).transpose()?;
    check_port(u64::from(s.daemon_port)).map(drop)
}

/// The schema version of the registry file this app writes.
pub const REGISTRY_V3: u32 = 3;
/// The version 2 file: read, and written back as version 3.
const REGISTRY_V2: u32 = 2;

/// One entry of the version 3 file. Which fields are present depends on `kind`: `local` has
/// `hasPassword`, `direct` has `address` and `hasPassword`, `relay` has neither (`hasPassword` is
/// always false there: its secret is a pairing link, always in the store), `ssh` has `host`,
/// `daemonPort` and the other SSH fields, no `address`. Unknown fields are kept and written back.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryV3 {
    pub id: EntryId,
    pub kind: Kind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(default)]
    pub has_password: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jump: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daemon_port: Option<u16>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub has_ssh_password: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub has_passphrase: bool,
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

fn is_false(b: &bool) -> bool {
    !*b
}

impl EntryV3 {
    /// An entry without SSH fields.
    fn plain(id: EntryId, kind: Kind, name: String, address: Option<String>, has_password: bool, unknown: Map<String, Value>) -> EntryV3 {
        EntryV3 {
            id,
            kind,
            name,
            address,
            has_password,
            host: None,
            user: None,
            port: None,
            identity_file: None,
            jump: None,
            daemon_port: None,
            has_ssh_password: false,
            has_passphrase: false,
            unknown,
        }
    }

    fn local() -> EntryV3 {
        EntryV3::plain(EntryId::local(), Kind::Local, LOCAL_NAME.to_owned(), None, false, Map::new())
    }

    /// An SSH entry's fields; `None` for another kind or when a required field is missing.
    pub fn ssh_fields(&self) -> Option<SshFields> {
        if self.kind != Kind::Ssh {
            return None;
        }
        Some(SshFields {
            host: self.host.clone()?,
            user: self.user.clone(),
            port: self.port,
            identity_file: self.identity_file.clone(),
            jump: self.jump.clone(),
            daemon_port: self.daemon_port?,
        })
    }

    fn has_ssh_data(&self) -> bool {
        self.host.is_some()
            || self.user.is_some()
            || self.port.is_some()
            || self.identity_file.is_some()
            || self.jump.is_some()
            || self.daemon_port.is_some()
            || self.has_ssh_password
            || self.has_passphrase
    }

    /// The display text `[user@]host[:port]` of an SSH entry.
    fn ssh_address(s: &SshFields) -> String {
        let mut out = String::new();
        if let Some(user) = &s.user {
            out.push_str(user);
            out.push('@');
        }
        out.push_str(&s.host);
        if let Some(port) = s.port {
            out.push(':');
            out.push_str(&port.to_string());
        }
        out
    }

    /// The entry as the page, the menu and the control socket see it.
    pub fn view(&self) -> EntryView {
        let ssh = self.ssh_fields();
        let address = match &ssh {
            Some(s) => Some(EntryV3::ssh_address(s)),
            None => self.address.clone(),
        };
        let ssh = ssh.map(|s| SshView {
            host: s.host,
            user: s.user,
            port: s.port,
            identity_file: s.identity_file,
            jump: s.jump,
            daemon_port: s.daemon_port,
            has_ssh_password: self.has_ssh_password,
            has_passphrase: self.has_passphrase,
        });
        EntryView { id: self.id.as_str().to_owned(), kind: self.kind, name: self.name.clone(), address, has_password: self.has_password, ssh }
    }

    fn consistent(&self) -> bool {
        let id_ok = (self.kind == Kind::Local) == (self.id.as_str() == LOCAL_ENTRY);
        let fields_ok = match self.kind {
            Kind::Local => self.address.is_none() && !self.has_ssh_data(),
            Kind::Direct => self.address.is_some() && !self.has_ssh_data(),
            Kind::Relay => self.address.is_none() && !self.has_password && !self.has_ssh_data(),
            Kind::Ssh => self.address.is_none() && self.ssh_fields().is_some_and(|s| check_ssh(&s).is_ok()),
        };
        id_ok && fields_ok
    }
}

/// The `daemons.json` document, version 3: no secret in it. Unknown fields are kept.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryV3 {
    pub version: u32,
    #[serde(default)]
    pub last_used_id: Option<EntryId>,
    pub entries: Vec<EntryV3>,
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

impl Default for RegistryV3 {
    fn default() -> Self {
        RegistryV3 { version: REGISTRY_V3, last_used_id: None, entries: vec![EntryV3::local()], unknown: Map::new() }
    }
}

impl RegistryV3 {
    fn valid(&self) -> bool {
        let mut ids = HashSet::new();
        self.entries.iter().all(|e| e.consistent() && ids.insert(e.id.as_str())) && self.entries.iter().filter(|e| e.kind == Kind::Local).count() <= 1
    }

    /// A version 2 file has no `ssh` entry.
    fn valid_v2(&self) -> bool {
        self.valid() && self.entries.iter().all(|e| e.kind != Kind::Ssh)
    }

    /// Creates the `local` entry when missing and drops a `lastUsedId` that names no entry.
    fn normalise(mut self) -> RegistryV3 {
        if !self.entries.iter().any(|e| e.kind == Kind::Local) {
            self.entries.insert(0, EntryV3::local());
        }
        if let Some(id) = &self.last_used_id
            && !self.entries.iter().any(|e| e.id == *id)
        {
            self.last_used_id = None;
        }
        self
    }

    pub fn get(&self, id: &str) -> Option<&EntryV3> {
        self.entries.iter().find(|e| e.id.as_str() == id)
    }

    /// Every entry without its secrets, in order.
    pub fn views(&self) -> Vec<EntryView> {
        self.entries.iter().map(EntryV3::view).collect()
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
    pub fn add(&self, id: EntryId, new: NewEntry) -> Result<RegistryV3, RegistryError> {
        if id.as_str() == LOCAL_ENTRY || self.get(id.as_str()).is_some() {
            return Err(RegistryError::InvalidId);
        }
        let name = self.check_name(new.name(), None)?;
        let entry = match new {
            NewEntry::Direct { address, has_password, .. } => {
                check_address(&address)?;
                EntryV3::plain(id, Kind::Direct, name, Some(address), has_password, Map::new())
            }
            NewEntry::Relay { .. } => EntryV3::plain(id, Kind::Relay, name, None, false, Map::new()),
            NewEntry::Ssh { ssh, has_password, has_ssh_password, has_passphrase, .. } => {
                check_ssh(&ssh)?;
                EntryV3 {
                    host: Some(ssh.host),
                    user: ssh.user,
                    port: ssh.port,
                    identity_file: ssh.identity_file,
                    jump: ssh.jump,
                    daemon_port: Some(ssh.daemon_port),
                    has_ssh_password,
                    has_passphrase,
                    ..EntryV3::plain(id, Kind::Ssh, name, None, has_password, Map::new())
                }
            }
        };
        if self.entries.len() >= MAX_ENTRIES {
            return Err(RegistryError::TooMany);
        }
        let mut next = self.clone();
        next.entries.push(entry);
        Ok(next)
    }

    /// Applies `update` to the entry `id`; nothing changes unless every field is accepted.
    pub fn update(&self, id: &str, update: Update) -> Result<RegistryV3, RegistryError> {
        let entry = self.get(id).ok_or(RegistryError::NotFound)?;
        let has_address = entry.kind == Kind::Direct;
        let has_password = entry.kind != Kind::Relay;
        let has_link = entry.kind == Kind::Relay;
        let has_ssh = entry.kind == Kind::Ssh;
        if (update.address.is_some() && !has_address)
            || (update.has_password.is_some() && !has_password)
            || (update.new_link && !has_link)
            || (update.has_ssh_field() && !has_ssh)
        {
            return Err(RegistryError::WrongKind);
        }
        let name = update.name.as_deref().map(|n| self.check_name(n, Some(id))).transpose()?;
        if let Some(a) = &update.address {
            check_address(a)?;
        }
        update.host.as_deref().map(check_host).transpose()?;
        update.user.iter().flatten().try_for_each(|u| check_user(u))?;
        update.port.flatten().map(|p| check_port(u64::from(p))).transpose()?;
        update.identity_file.iter().flatten().try_for_each(|p| check_identity_file(p))?;
        update.jump.iter().flatten().try_for_each(|j| check_jump(j))?;
        update.daemon_port.map(|p| check_port(u64::from(p))).transpose()?;
        let mut next = self.clone();
        if let Some(e) = next.entries.iter_mut().find(|e| e.id.as_str() == id) {
            if let Some(name) = name {
                e.name = name;
            }
            if let Some(a) = update.address {
                e.address = Some(a);
            }
            if let Some(p) = update.has_password {
                e.has_password = p;
            }
            if let Some(host) = update.host {
                e.host = Some(host);
            }
            if let Some(user) = update.user {
                e.user = user;
            }
            if let Some(port) = update.port {
                e.port = port;
            }
            if let Some(path) = update.identity_file {
                e.identity_file = path;
            }
            if let Some(jump) = update.jump {
                e.jump = jump;
            }
            if let Some(port) = update.daemon_port {
                e.daemon_port = Some(port);
            }
            if let Some(p) = update.has_ssh_password {
                e.has_ssh_password = p;
            }
            if let Some(p) = update.has_passphrase {
                e.has_passphrase = p;
            }
        }
        Ok(next)
    }

    /// Removes an entry; `lastUsedId` becomes null when it named the removed entry.
    pub fn remove(&self, id: &str) -> Result<RegistryV3, RegistryError> {
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

    pub fn set_last_used(&self, id: &str) -> Result<RegistryV3, RegistryError> {
        let entry = self.get(id).ok_or(RegistryError::NotFound)?;
        let mut next = self.clone();
        next.last_used_id = Some(entry.id.clone());
        Ok(next)
    }
}

/// A secret found in a version 1 file: the entry it belongs to, that entry's kind (a `relay`
/// secret is its pairing link, the others a password) and the value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MigratedSecret {
    pub id: EntryId,
    pub kind: Kind,
    pub secret: Secret,
}

/// Decodes a version 3 `daemons.json`. A missing `local` entry is created and a `lastUsedId` that
/// names no entry becomes null; two `local` entries, a repeated id or an entry whose fields do not
/// match its kind make the document `WrongShape`. A `password` or `pairingLink` field is just an
/// unknown field here, never a secret.
pub fn decode_registry_v3(bytes: &[u8]) -> Result<RegistryV3, DecodeError> {
    decode_at(bytes, REGISTRY_V3, RegistryV3::valid).map(RegistryV3::normalise)
}

pub fn encode_registry_v3(registry: &RegistryV3) -> Vec<u8> {
    encode(registry)
}

/// A version 2 file, as a version 3 document (it has no `ssh` entry).
fn decode_registry_v2(bytes: &[u8]) -> Result<RegistryV3, DecodeError> {
    decode_at(bytes, REGISTRY_V2, RegistryV3::valid_v2).map(RegistryV3::normalise).map(|doc| RegistryV3 { version: REGISTRY_V3, ..doc })
}

/// Reads any file version: version 1 gives the version 3 document and its secrets, versions 2 and 3
/// the document and no secrets; any other version is `UnknownVersion`.
pub fn decode_registry_any(bytes: &[u8]) -> Result<(RegistryV3, Vec<MigratedSecret>), DecodeError> {
    let secret_free = |doc| (doc, Vec::new());
    match decode_registry_v3(bytes) {
        Err(DecodeError::UnknownVersion) => match decode_registry_v2(bytes) {
            Err(DecodeError::UnknownVersion) => decode(bytes, RegistryV1::valid).map(RegistryV1::normalise).map(|v1| v1.into_v3()),
            other => other.map(secret_free),
        },
        other => other.map(secret_free),
    }
}

/// An entry of the version 1 file, which held its secrets. Only read, to move the secrets out.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntryV1 {
    id: EntryId,
    kind: Kind,
    name: String,
    #[serde(default)]
    address: Option<String>,
    #[serde(default)]
    password: Option<Secret>,
    #[serde(default)]
    pairing_link: Option<Secret>,
    #[serde(flatten)]
    unknown: Map<String, Value>,
}

impl EntryV1 {
    fn local() -> EntryV1 {
        EntryV1 { id: EntryId::local(), kind: Kind::Local, name: LOCAL_NAME.to_owned(), address: None, password: None, pairing_link: None, unknown: Map::new() }
    }

    /// Whether the fields present match the kind and the id matches the kind.
    fn consistent(&self) -> bool {
        let id_ok = (self.kind == Kind::Local) == (self.id.as_str() == LOCAL_ENTRY);
        let fields_ok = match self.kind {
            Kind::Local => self.address.is_none() && self.pairing_link.is_none(),
            Kind::Direct => self.address.is_some() && self.pairing_link.is_none(),
            Kind::Relay => self.address.is_none() && self.pairing_link.is_some() && self.password.is_none(),
            // A version 1 file predates SSH entries.
            Kind::Ssh => false,
        };
        id_ok && fields_ok
    }
}

/// The version 1 `daemons.json` document.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryV1 {
    #[serde(default)]
    last_used_id: Option<EntryId>,
    entries: Vec<EntryV1>,
    #[serde(flatten)]
    unknown: Map<String, Value>,
}

impl RegistryV1 {
    fn valid(&self) -> bool {
        let mut ids = HashSet::new();
        self.entries.iter().all(|e| e.consistent() && ids.insert(e.id.as_str())) && self.entries.iter().filter(|e| e.kind == Kind::Local).count() <= 1
    }

    fn normalise(mut self) -> RegistryV1 {
        if !self.entries.iter().any(|e| e.kind == Kind::Local) {
            self.entries.insert(0, EntryV1::local());
        }
        if let Some(id) = &self.last_used_id
            && !self.entries.iter().any(|e| e.id == *id)
        {
            self.last_used_id = None;
        }
        self
    }

    /// The version 3 document and the secrets that version 1 held.
    fn into_v3(self) -> (RegistryV3, Vec<MigratedSecret>) {
        let mut secrets = Vec::new();
        let entries = self
            .entries
            .into_iter()
            .map(|e| {
                let secret = match e.kind {
                    Kind::Relay => e.pairing_link,
                    Kind::Local | Kind::Direct | Kind::Ssh => e.password,
                };
                let has_password = e.kind != Kind::Relay && secret.is_some();
                if let Some(secret) = secret {
                    secrets.push(MigratedSecret { id: e.id.clone(), kind: e.kind, secret });
                }
                let mut unknown = e.unknown;
                unknown.remove("hasPassword");
                EntryV3::plain(e.id, e.kind, e.name, e.address, has_password, unknown)
            })
            .collect();
        // `version` is not a field of the version 1 struct, so it landed in `unknown`: drop it, or it
        // would be written next to the real one.
        let mut unknown = self.unknown;
        unknown.remove("version");
        (RegistryV3 { version: REGISTRY_V3, last_used_id: self.last_used_id, entries, unknown }, secrets)
    }
}

/// Why a local daemon action failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailReason {
    NotHealthy,
    Timeout,
    BadOutput,
    SpawnFailed,
    /// `pi-studio update` failed; the state carries the output's last lines.
    UpdateFailed,
}

impl FailReason {
    /// The code a rejected `resolveCurrent` carries.
    pub fn code(self) -> &'static str {
        match self {
            FailReason::NotHealthy => "not_healthy",
            FailReason::Timeout => "timeout",
            FailReason::BadOutput => "bad_output",
            FailReason::SpawnFailed => "spawn_failed",
            FailReason::UpdateFailed => "update_failed",
        }
    }
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
    /// `pi-studio update` is running, then the version is read again and the daemon started.
    Updating,
    Running {
        host: String,
        port: u16,
    },
    Failed {
        reason: FailReason,
        /// The last lines `pi-studio update` printed, for `update_failed`: shown to the user,
        /// never parsed.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output: Option<String>,
    },
}

/// Why a remote daemon action failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteFailReason {
    NotHealthy,
    Timeout,
    BadOutput,
    /// The command could not be run on the host.
    ExecFailed,
    /// The account runs no commands.
    NoShell,
    /// `pi-studio update` failed on the host; the state carries the output's last lines.
    UpdateFailed,
}

impl RemoteFailReason {
    pub fn code(self) -> &'static str {
        match self {
            RemoteFailReason::NotHealthy => "not_healthy",
            RemoteFailReason::Timeout => "timeout",
            RemoteFailReason::BadOutput => "bad_output",
            RemoteFailReason::ExecFailed => "exec_failed",
            RemoteFailReason::NoShell => "no_shell",
            RemoteFailReason::UpdateFailed => "update_failed",
        }
    }
}

/// The state of the current SSH entry's daemon, in memory only. JSON form: `{ "state": "...", ... }`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum RemoteState {
    /// Nothing was learned since the entry was opened.
    Unknown,
    Checking,
    Running,
    Stopped,
    NotInstalled,
    CliOutdated {
        version: String,
    },
    Starting,
    /// `pi-studio update` is running on the host, then the version is read again and the daemon started.
    Updating,
    Failed {
        reason: RemoteFailReason,
        /// The last lines `pi-studio update` printed, for `update_failed`: shown to the user,
        /// never parsed.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output: Option<String>,
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
        NewEntry::Direct { name: name.into(), address: "host:1".into(), has_password: false }
    }

    fn fields(host: &str) -> SshFields {
        SshFields { host: host.into(), user: None, port: None, identity_file: None, jump: None, daemon_port: DEFAULT_DAEMON_PORT }
    }

    fn ssh_with(name: &str, ssh: SshFields) -> NewEntry {
        NewEntry::Ssh { name: name.into(), ssh, has_password: false, has_ssh_password: false, has_passphrase: false }
    }

    fn with_work() -> RegistryV3 {
        RegistryV3::default().add(id(A), direct("work")).unwrap()
    }

    fn with_ssh() -> RegistryV3 {
        RegistryV3::default().add(id(A), ssh_with("box", fields("box.example"))).unwrap()
    }

    #[test]
    fn local_is_created_and_duplicated_is_wrong_shape() {
        let r = decode_registry_v3(br#"{"version":3,"entries":[]}"#).unwrap();
        assert_eq!(r.entries.len(), 1);
        assert_eq!(r.entries[0].name, LOCAL_NAME);
        let two = json!({"version":3,"entries":[
            {"id":"local","kind":"local","name":"a"},{"id":"local","kind":"local","name":"b"}]});
        assert_eq!(decode_registry_v3(two.to_string().as_bytes()), Err(DecodeError::WrongShape));
        let dup = json!({"version":3,"entries":[
            {"id":A,"kind":"direct","name":"a","address":"x"},{"id":A,"kind":"direct","name":"b","address":"x"}]});
        assert_eq!(decode_registry_v3(dup.to_string().as_bytes()), Err(DecodeError::WrongShape));
        assert_eq!(decode_registry_v3(br#"{"version":4,"entries":[]}"#), Err(DecodeError::UnknownVersion));
        assert_eq!(decode_registry_v3(b"x"), Err(DecodeError::NotJson));
        let bad_kind = json!({"version":3,"entries":[{"id":A,"kind":"direct","name":"a"}]});
        assert_eq!(decode_registry_v3(bad_kind.to_string().as_bytes()), Err(DecodeError::WrongShape));
    }

    #[test]
    fn dangling_last_used_becomes_null() {
        let src = json!({"version":3,"lastUsedId":A,"entries":[]});
        assert_eq!(decode_registry_v3(src.to_string().as_bytes()).unwrap().last_used_id, None);
        let src = json!({"version":3,"lastUsedId":"local","entries":[]});
        assert_eq!(decode_registry_v3(src.to_string().as_bytes()).unwrap().last_used_id, Some(EntryId::local()));
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
        let r = RegistryV3::default();
        let d = |address: String| NewEntry::Direct { name: "n".into(), address, has_password: false };
        assert_eq!(r.add(id(A), d("a".repeat(2049))).unwrap_err(), RegistryError::InvalidAddress);
        assert!(r.add(id(A), d("a".repeat(2048))).is_ok());
        assert_eq!(r.add(id(A), d(String::new())).unwrap_err(), RegistryError::InvalidAddress);
        assert_eq!(check_password(""), Err(RegistryError::InvalidPassword));
        assert_eq!(check_password(&"p".repeat(1025)), Err(RegistryError::InvalidPassword));
        assert!(check_password(&"p".repeat(1024)).is_ok());
        let link = |len: usize| {
            let head = "#offer=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&host=";
            format!("{head}{}", "h".repeat(len - head.len()))
        };
        assert_eq!(check_link(&link(4097)), Err(RegistryError::InvalidLink));
        assert_eq!(check_link(""), Err(RegistryError::InvalidLink));
        assert_eq!(check_link(&"l".repeat(4096)), Err(RegistryError::InvalidLink));
        assert!(check_link(&link(4096)).is_ok());
        let mut full = r;
        for i in 1..MAX_ENTRIES {
            full = full.add(id(&format!("123e4567-e89b-12d3-a456-{i:012x}")), direct(&format!("e{i}"))).unwrap();
        }
        assert_eq!(full.entries.len(), MAX_ENTRIES);
        assert_eq!(full.add(id(A), direct("extra")).unwrap_err(), RegistryError::TooMany);
        assert_eq!(RegistryV3::default().add(id(A), direct("a")).unwrap().add(id(A), direct("b")).unwrap_err(), RegistryError::InvalidId);
        assert_eq!(RegistryV3::default().add(EntryId::local(), direct("a")).unwrap_err(), RegistryError::InvalidId);
    }

    #[test]
    fn update_rules() {
        let relay = RegistryV3::default().add(id(B), NewEntry::Relay { name: "r".into() }).unwrap();
        let r = with_work();
        assert_eq!(relay.update(B, Update { address: Some("x".into()), ..Update::default() }).unwrap_err(), RegistryError::WrongKind);
        assert_eq!(relay.update(B, Update { has_password: Some(false), ..Update::default() }).unwrap_err(), RegistryError::WrongKind);
        assert_eq!(r.update(A, Update { new_link: true, ..Update::default() }).unwrap_err(), RegistryError::WrongKind);
        assert_eq!(r.update("local", Update { address: Some("x".into()), ..Update::default() }).unwrap_err(), RegistryError::WrongKind);
        assert_eq!(r.update(B, Update::default()).unwrap_err(), RegistryError::NotFound);
        let set = r.update(A, Update { has_password: Some(true), address: Some("h:2".into()), ..Update::default() }).unwrap();
        assert!(set.get(A).unwrap().view().has_password);
        assert_eq!(set.get(A).unwrap().address.as_deref(), Some("h:2"));
        let cleared = set.update(A, Update { has_password: Some(false), ..Update::default() }).unwrap();
        assert!(!cleared.get(A).unwrap().view().has_password);
        assert_eq!(set.update(A, Update::default()).unwrap(), set);
        // a refused update changes nothing, even when an earlier field was fine
        assert!(r.update(A, Update { name: Some("ok".into()), address: Some(String::new()), ..Update::default() }).is_err());
        // a replaced link changes no field of the document, but only a relay entry may have one
        assert_eq!(relay.update(B, Update { new_link: true, ..Update::default() }).unwrap(), relay);
        let local = r.update("local", Update { has_password: Some(true), name: Some("Me".into()), ..Update::default() }).unwrap();
        assert_eq!(local.get("local").unwrap().name, "Me");
        assert!(local.get("local").unwrap().has_password);
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
    fn views_say_has_password_and_hold_nothing_else_secret() {
        let r = RegistryV3::default()
            .add(id(A), NewEntry::Direct { name: "d".into(), address: "h:1".into(), has_password: true })
            .unwrap()
            .add(id(B), NewEntry::Relay { name: "r".into() })
            .unwrap();
        let view = r.get(A).unwrap().view();
        assert!(view.has_password);
        assert_eq!(serde_json::to_value(&view).unwrap(), json!({"id":A,"kind":"direct","name":"d","address":"h:1","hasPassword":true}));
        let relay_view = serde_json::to_value(r.get(B).unwrap().view()).unwrap();
        assert_eq!(relay_view, json!({"id":B,"kind":"relay","name":"r","hasPassword":false}));
        assert_eq!(r.views().len(), 3);
        assert_eq!(format!("{:?}", Secret::new("x")), "<secret>");
    }

    #[test]
    fn unknown_fields_survive() {
        let src = json!({"version":3,"lastUsedId":null,"future":{"a":1},"entries":[
            {"id":"local","kind":"local","name":"m","extra":[1]},
            {"id":A,"kind":"direct","name":"d","address":"h","hasPassword":true,"note":true}]});
        let r = decode_registry_v3(src.to_string().as_bytes()).unwrap();
        let back: Value = serde_json::from_slice(&encode_registry_v3(&r)).unwrap();
        assert_eq!(back["future"], json!({"a":1}));
        assert_eq!(back["entries"][0]["extra"], json!([1]));
        assert_eq!(back["entries"][1]["note"], json!(true));
        let after = r.update(A, Update { name: Some("e".into()), ..Update::default() }).unwrap();
        assert_eq!(after.get(A).unwrap().unknown["note"], json!(true));
        assert_eq!(decode_registry_v3(&encode_registry_v3(&r)).unwrap(), r);
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
            (LocalState::Updating, json!({"state":"updating"})),
            (LocalState::Running { host: "127.0.0.1".into(), port: 7777 }, json!({"state":"running","host":"127.0.0.1","port":7777})),
            (LocalState::Failed { reason: FailReason::NotHealthy, output: None }, json!({"state":"failed","reason":"not_healthy"})),
            (LocalState::Failed { reason: FailReason::Timeout, output: None }, json!({"state":"failed","reason":"timeout"})),
            (LocalState::Failed { reason: FailReason::BadOutput, output: None }, json!({"state":"failed","reason":"bad_output"})),
            (LocalState::Failed { reason: FailReason::SpawnFailed, output: None }, json!({"state":"failed","reason":"spawn_failed"})),
            (
                LocalState::Failed { reason: FailReason::UpdateFailed, output: Some("npm ERR! x".into()) },
                json!({"state":"failed","reason":"update_failed","output":"npm ERR! x"}),
            ),
        ];
        for (state, value) in cases {
            assert_eq!(serde_json::to_value(&state).unwrap(), value);
            assert_eq!(serde_json::from_value::<LocalState>(value).unwrap(), state);
        }
    }

    #[test]
    fn remote_state_json() {
        let failed = |reason| RemoteState::Failed { reason, output: None };
        let cases = [
            (RemoteState::Unknown, json!({"state":"unknown"})),
            (RemoteState::Checking, json!({"state":"checking"})),
            (RemoteState::Running, json!({"state":"running"})),
            (RemoteState::Stopped, json!({"state":"stopped"})),
            (RemoteState::NotInstalled, json!({"state":"not_installed"})),
            (RemoteState::CliOutdated { version: "0.0.100".into() }, json!({"state":"cli_outdated","version":"0.0.100"})),
            (RemoteState::Starting, json!({"state":"starting"})),
            (failed(RemoteFailReason::NotHealthy), json!({"state":"failed","reason":"not_healthy"})),
            (failed(RemoteFailReason::Timeout), json!({"state":"failed","reason":"timeout"})),
            (failed(RemoteFailReason::BadOutput), json!({"state":"failed","reason":"bad_output"})),
            (failed(RemoteFailReason::ExecFailed), json!({"state":"failed","reason":"exec_failed"})),
            (failed(RemoteFailReason::NoShell), json!({"state":"failed","reason":"no_shell"})),
            (RemoteState::Updating, json!({"state":"updating"})),
            (
                RemoteState::Failed { reason: RemoteFailReason::UpdateFailed, output: Some("npm ERR! x".into()) },
                json!({"state":"failed","reason":"update_failed","output":"npm ERR! x"}),
            ),
        ];
        for (state, value) in cases {
            assert_eq!(serde_json::to_value(&state).unwrap(), value);
            assert_eq!(serde_json::from_value::<RemoteState>(value).unwrap(), state);
        }
        assert_eq!(RemoteFailReason::ExecFailed.code(), "exec_failed");
        assert_eq!(RemoteFailReason::NoShell.code(), "no_shell");
    }

    #[test]
    fn error_codes() {
        assert_eq!(RegistryError::LocalNotRemovable.code(), "local_not_removable");
        assert_eq!(RegistryError::TooMany.code(), "too_many");
        let codes = [
            (RegistryError::InvalidHost, "invalid_host"),
            (RegistryError::InvalidUser, "invalid_user"),
            (RegistryError::InvalidPort, "invalid_port"),
            (RegistryError::InvalidPath, "invalid_path"),
            (RegistryError::InvalidJump, "invalid_jump"),
        ];
        for (error, code) in codes {
            assert_eq!(error.code(), code);
        }
    }

    #[test]
    fn ssh_field_rules_on_add() {
        let r = RegistryV3::default();
        let add = |ssh: SshFields| r.add(id(A), ssh_with("s", ssh)).map(drop);
        assert_eq!(add(fields("")), Err(RegistryError::InvalidHost));
        assert_eq!(add(fields("a b")), Err(RegistryError::InvalidHost));
        assert_eq!(add(fields("a\tb")), Err(RegistryError::InvalidHost));
        assert_eq!(add(fields(&"h".repeat(256))), Err(RegistryError::InvalidHost));
        assert_eq!(add(fields(&"h".repeat(255))), Ok(()));
        assert_eq!(add(SshFields { user: Some(String::new()), ..fields("h") }), Err(RegistryError::InvalidUser));
        assert_eq!(add(SshFields { user: Some("u".repeat(65)), ..fields("h") }), Err(RegistryError::InvalidUser));
        assert_eq!(add(SshFields { user: Some("u".repeat(64)), ..fields("h") }), Ok(()));
        assert_eq!(add(SshFields { port: Some(0), ..fields("h") }), Err(RegistryError::InvalidPort));
        assert_eq!(add(SshFields { port: Some(65535), ..fields("h") }), Ok(()));
        assert_eq!(add(SshFields { daemon_port: 0, ..fields("h") }), Err(RegistryError::InvalidPort));
        assert_eq!(add(SshFields { identity_file: Some(String::new()), ..fields("h") }), Err(RegistryError::InvalidPath));
        assert_eq!(add(SshFields { identity_file: Some("p".repeat(4097)), ..fields("h") }), Err(RegistryError::InvalidPath));
        assert_eq!(add(SshFields { identity_file: Some("~/.ssh/id".into()), ..fields("h") }), Ok(()));
        assert_eq!(add(SshFields { jump: Some("a,".into()), ..fields("h") }), Err(RegistryError::InvalidJump));
        assert_eq!(add(SshFields { jump: Some("u@a:22,b".into()), ..fields("h") }), Ok(()));
        // the name and the cap are still checked
        assert_eq!(r.add(id(A), ssh_with(" ", fields("h"))).unwrap_err(), RegistryError::InvalidName);
        assert_eq!(with_ssh().add(id(B), ssh_with("BOX", fields("h"))).unwrap_err(), RegistryError::NameTaken);
    }

    #[test]
    fn port_rule() {
        assert_eq!(check_port(1), Ok(1));
        assert_eq!(check_port(65535), Ok(65535));
        assert_eq!(check_port(0), Err(RegistryError::InvalidPort));
        assert_eq!(check_port(65536), Err(RegistryError::InvalidPort));
        assert_eq!(check_port(u64::MAX), Err(RegistryError::InvalidPort));
    }

    #[test]
    fn jump_rule() {
        for ok in ["a", "u@a:22", "a,b", "u@a:1,v@b,c:65535", "[::1]:22", "[::1]", "x@[fe80::1]:2"] {
            assert_eq!(check_jump(ok), Ok(()), "{ok}");
        }
        for bad in ["", ",", "a,", ",a", "a b", "a, b", "a:0", "a:65536", "a:x", "a:", "@a", "u@", "[a", "[a]x", "a:1:2", "[::1]:", "a:123456"] {
            assert_eq!(check_jump(bad), Err(RegistryError::InvalidJump), "{bad}");
        }
        let hops = |last: String| format!("{},{last}", vec!["h".repeat(255); 3].join(","));
        assert_eq!(check_jump(&hops(format!("u@{}", "h".repeat(254)))), Ok(()));
        assert_eq!(check_jump(&hops(format!("u@{}", "h".repeat(255)))), Err(RegistryError::InvalidJump));
        assert_eq!(check_jump(&format!("u@{}", "h".repeat(256))), Err(RegistryError::InvalidJump));
        assert_eq!(check_jump(&format!("{}@h", "u".repeat(65))), Err(RegistryError::InvalidJump));
    }

    #[test]
    fn ssh_update_sets_and_clears() {
        let full = RegistryV3::default()
            .add(
                id(A),
                NewEntry::Ssh {
                    name: "box".into(),
                    ssh: SshFields {
                        host: "h".into(),
                        user: Some("me".into()),
                        port: Some(2222),
                        identity_file: Some("~/k".into()),
                        jump: Some("j".into()),
                        daemon_port: 7000,
                    },
                    has_password: true,
                    has_ssh_password: true,
                    has_passphrase: true,
                },
            )
            .unwrap();
        let cleared = full
            .update(
                A,
                Update {
                    host: Some("h2".into()),
                    user: Some(None),
                    port: Some(None),
                    identity_file: Some(None),
                    jump: Some(None),
                    daemon_port: Some(6768),
                    has_password: Some(false),
                    has_ssh_password: Some(false),
                    has_passphrase: Some(false),
                    ..Update::default()
                },
            )
            .unwrap();
        let e = cleared.get(A).unwrap();
        assert_eq!(e.ssh_fields(), Some(SshFields { daemon_port: 6768, ..fields("h2") }));
        assert!(!e.has_password && !e.has_ssh_password && !e.has_passphrase);
        let text = String::from_utf8(encode_registry_v3(&cleared)).unwrap();
        assert!(!text.contains("\"user\"") && !text.contains("identityFile") && !text.contains("hasSshPassword"));
        let set =
            cleared.update(A, Update { user: Some(Some("you".into())), port: Some(Some(22)), jump: Some(Some("a,b".into())), ..Update::default() }).unwrap();
        assert_eq!(set.get(A).unwrap().user.as_deref(), Some("you"));
        assert_eq!(set.get(A).unwrap().port, Some(22));
        assert_eq!(decode_registry_v3(&encode_registry_v3(&set)), Ok(set.clone()));
        // each rule is enforced and a refusal changes nothing
        let refuse = |u: Update| set.update(A, u).unwrap_err();
        assert_eq!(refuse(Update { host: Some("a b".into()), ..Update::default() }), RegistryError::InvalidHost);
        assert_eq!(refuse(Update { user: Some(Some(String::new())), ..Update::default() }), RegistryError::InvalidUser);
        assert_eq!(refuse(Update { port: Some(Some(0)), ..Update::default() }), RegistryError::InvalidPort);
        assert_eq!(refuse(Update { daemon_port: Some(0), ..Update::default() }), RegistryError::InvalidPort);
        assert_eq!(refuse(Update { identity_file: Some(Some(String::new())), ..Update::default() }), RegistryError::InvalidPath);
        assert_eq!(refuse(Update { jump: Some(Some("a,,b".into())), ..Update::default() }), RegistryError::InvalidJump);
        assert_eq!(refuse(Update { name: Some("ok".into()), host: Some(String::new()), ..Update::default() }), RegistryError::InvalidHost);
        // an SSH entry has a daemon password, not an address or a link
        assert!(set.update(A, Update { has_password: Some(true), ..Update::default() }).is_ok());
        assert_eq!(refuse(Update { address: Some("x".into()), ..Update::default() }), RegistryError::WrongKind);
        assert_eq!(refuse(Update { new_link: true, ..Update::default() }), RegistryError::WrongKind);
    }

    #[test]
    fn ssh_fields_on_other_kinds_are_wrong_kind() {
        let r = with_work().add(id(B), NewEntry::Relay { name: "r".into() }).unwrap();
        let updates = [
            Update { host: Some("h".into()), ..Update::default() },
            Update { user: Some(None), ..Update::default() },
            Update { port: Some(Some(22)), ..Update::default() },
            Update { identity_file: Some(None), ..Update::default() },
            Update { jump: Some(None), ..Update::default() },
            Update { daemon_port: Some(1), ..Update::default() },
            Update { has_ssh_password: Some(false), ..Update::default() },
            Update { has_passphrase: Some(false), ..Update::default() },
        ];
        for target in [A, B, "local"] {
            for u in &updates {
                assert_eq!(r.update(target, u.clone()).unwrap_err(), RegistryError::WrongKind);
            }
        }
    }

    #[test]
    fn ssh_view_shows_address_and_fields() {
        let r = RegistryV3::default()
            .add(
                id(A),
                NewEntry::Ssh {
                    name: "box".into(),
                    ssh: SshFields { user: Some("me".into()), port: Some(2222), ..fields("h") },
                    has_password: false,
                    has_ssh_password: true,
                    has_passphrase: false,
                },
            )
            .unwrap()
            .add(id(B), ssh_with("bare", fields("bare.example")))
            .unwrap();
        assert_eq!(
            serde_json::to_value(r.get(A).unwrap().view()).unwrap(),
            json!({"id":A,"kind":"ssh","name":"box","address":"me@h:2222","hasPassword":false,
                "ssh":{"host":"h","user":"me","port":2222,"daemonPort":6767,"hasSshPassword":true,"hasPassphrase":false}})
        );
        let bare = r.get(B).unwrap().view();
        assert_eq!(bare.address.as_deref(), Some("bare.example"));
        assert_eq!(serde_json::to_value(&bare).unwrap()["ssh"], json!({"host":"bare.example","daemonPort":6767,"hasSshPassword":false,"hasPassphrase":false}));
        let user_only = SshFields { user: Some("u".into()), ..fields("h") };
        let r = RegistryV3::default().add(id(A), ssh_with("x", user_only)).unwrap();
        assert_eq!(r.get(A).unwrap().view().address.as_deref(), Some("u@h"));
        let port_only = SshFields { port: Some(1), ..fields("h") };
        let r = RegistryV3::default().add(id(A), ssh_with("x", port_only)).unwrap();
        assert_eq!(r.get(A).unwrap().view().address.as_deref(), Some("h:1"));
    }

    #[test]
    fn ssh_entry_in_the_file() {
        let src = json!({"version":3,"entries":[
            {"id":A,"kind":"ssh","name":"b","host":"h","daemonPort":6767,"hasPassword":true,"hasSshPassword":true,"note":1}]});
        let r = decode_registry_v3(src.to_string().as_bytes()).unwrap();
        let e = r.get(A).unwrap();
        assert!(e.has_password && e.has_ssh_password && !e.has_passphrase);
        assert_eq!(e.unknown.get("note"), Some(&Value::from(1)));
        assert_eq!(decode_registry_v3(&encode_registry_v3(&r)), Ok(r));
        let shape = |entry: Value| decode_registry_v3(json!({"version":3,"entries":[entry]}).to_string().as_bytes()).err();
        let wrong = Some(DecodeError::WrongShape);
        assert_eq!(shape(json!({"id":A,"kind":"ssh","name":"b","daemonPort":1})), wrong);
        assert_eq!(shape(json!({"id":A,"kind":"ssh","name":"b","host":"h"})), wrong);
        assert_eq!(shape(json!({"id":A,"kind":"ssh","name":"b","host":"h","daemonPort":1,"address":"x"})), wrong);
        assert_eq!(shape(json!({"id":A,"kind":"ssh","name":"b","host":"h b","daemonPort":1})), wrong);
        assert_eq!(shape(json!({"id":A,"kind":"ssh","name":"b","host":"h","daemonPort":0})), wrong);
        assert_eq!(shape(json!({"id":A,"kind":"ssh","name":"b","host":"h","daemonPort":70000})), wrong);
        assert_eq!(shape(json!({"id":A,"kind":"ssh","name":"b","host":"h","daemonPort":1,"jump":"a,"})), wrong);
        assert_eq!(shape(json!({"id":A,"kind":"direct","name":"b","address":"x","host":"h"})), wrong);
        assert_eq!(shape(json!({"id":A,"kind":"direct","name":"b","address":"x","hasSshPassword":true})), wrong);
        assert_eq!(shape(json!({"id":A,"kind":"relay","name":"b","daemonPort":1})), wrong);
        assert_eq!(shape(json!({"id":"local","kind":"local","name":"b","hasPassphrase":true})), wrong);
    }

    const V1: &str = r#"{"version":1,"lastUsedId":"3f2b8a40-1111-4222-8333-444455556666","extra":7,"entries":[
        {"id":"local","kind":"local","name":"This machine","password":"SECRET-L"},
        {"id":"3f2b8a40-1111-4222-8333-444455556666","kind":"direct","name":"d","address":"h:1","password":"SECRET-D","note":1},
        {"id":"3f2b8a40-1111-4222-8333-444455557777","kind":"relay","name":"r","pairingLink":"SECRET-R"}]}"#;

    #[test]
    fn v1_splits_into_document_and_secrets() {
        let (doc, secrets) = decode_registry_any(V1.as_bytes()).unwrap();
        assert_eq!(doc.version, 3);
        assert_eq!(doc.entries.iter().map(|e| e.has_password).collect::<Vec<_>>(), [true, true, false]);
        assert_eq!(secrets.len(), 3);
        assert_eq!((secrets[0].id.as_str(), secrets[0].kind, secrets[0].secret.expose()), ("local", Kind::Local, "SECRET-L"));
        assert_eq!(secrets[1].kind, Kind::Direct);
        assert_eq!((secrets[2].kind, secrets[2].secret.expose()), (Kind::Relay, "SECRET-R"));
        let text = String::from_utf8(encode_registry_v3(&doc)).unwrap_or_default();
        assert!(!text.contains("SECRET") && !text.contains("pairingLink"));
        assert!(text.contains("\"extra\"") && text.contains("\"note\""));
        // What was written reads back as version 3 (the old `version` is not an unknown field).
        assert_eq!(decode_registry_v3(text.as_bytes()), Ok(doc));
    }

    #[test]
    fn v1_keeps_its_repairs_and_refusals() {
        let (doc, secrets) = decode_registry_any(br#"{"version":1,"lastUsedId":"3f2b8a40-1111-4222-8333-444455556666","entries":[]}"#).unwrap();
        assert_eq!((doc.entries.len(), doc.last_used_id, secrets.len()), (1, None, 0));
        let two = json!({"version":1,"entries":[{"id":"local","kind":"local","name":"a"},{"id":"local","kind":"local","name":"b"}]});
        assert_eq!(decode_registry_any(two.to_string().as_bytes()).err(), Some(DecodeError::WrongShape));
        let bad = json!({"version":1,"entries":[{"id":A,"kind":"direct","name":"a"}]});
        assert_eq!(decode_registry_any(bad.to_string().as_bytes()).err(), Some(DecodeError::WrongShape));
    }

    #[test]
    fn v2_is_read_and_written_back_as_v3() {
        let text = r#"{"version":2,"lastUsedId":"3f2b8a40-1111-4222-8333-444455557777","entries":[
            {"id":"local","kind":"local","name":"This machine","hasPassword":true,"x":1},
            {"id":"3f2b8a40-1111-4222-8333-444455556666","kind":"direct","name":"d","address":"h:1","hasPassword":true},
            {"id":"3f2b8a40-1111-4222-8333-444455557777","kind":"relay","name":"r"}],"top":"t"}"#;
        let (doc, secrets) = decode_registry_any(text.as_bytes()).unwrap();
        assert!(secrets.is_empty());
        assert_eq!(doc.version, 3);
        assert_eq!(doc.entries.len(), 3);
        assert_eq!(doc.last_used_id.as_ref().map(EntryId::as_str), Some("3f2b8a40-1111-4222-8333-444455557777"));
        assert!(doc.entries[0].has_password && doc.entries[1].has_password && !doc.entries[2].has_password);
        let written = encode_registry_v3(&doc);
        let back: Value = serde_json::from_slice(&written).unwrap();
        assert_eq!(back["version"], json!(3));
        assert_eq!(decode_registry_v3(&written), Ok(doc.clone()));
        assert_eq!(decode_registry_any(&written), Ok((doc.clone(), Vec::new())));
        assert_eq!(doc.unknown.get("top"), Some(&Value::from("t")));
        assert_eq!(doc.entries[0].unknown.get("x"), Some(&Value::from(1)));
        assert!(!String::from_utf8(written).unwrap_or_default().contains("pairingLink"));
    }

    #[test]
    fn v2_keeps_its_rules_and_has_no_ssh() {
        let ssh = json!({"version":2,"entries":[{"id":A,"kind":"ssh","name":"s","host":"h","daemonPort":6767}]});
        assert_eq!(decode_registry_any(ssh.to_string().as_bytes()).err(), Some(DecodeError::WrongShape));
        let relay_pw = json!({"version":2,"entries":[{"id":A,"kind":"relay","name":"r","hasPassword":true}]});
        assert_eq!(decode_registry_any(relay_pw.to_string().as_bytes()).err(), Some(DecodeError::WrongShape));
        let direct_no_address = json!({"version":2,"entries":[{"id":A,"kind":"direct","name":"r"}]});
        assert_eq!(decode_registry_any(direct_no_address.to_string().as_bytes()).err(), Some(DecodeError::WrongShape));
        assert_eq!(decode_registry_any(b"[]").err(), Some(DecodeError::WrongShape));
        assert_eq!(decode_registry_any(b"x").err(), Some(DecodeError::NotJson));
    }

    #[test]
    fn version_four_is_unknown_and_a_password_field_is_not_a_secret() {
        assert_eq!(decode_registry_any(br#"{"version":4,"entries":[]}"#).err(), Some(DecodeError::UnknownVersion));
        assert_eq!(decode_registry_any(br#"{"version":0,"entries":[]}"#).err(), Some(DecodeError::UnknownVersion));
        for version in [2, 3] {
            let text = format!(r#"{{"version":{version},"entries":[{{"id":"local","kind":"local","name":"This machine","password":"P"}}]}}"#);
            let (doc, secrets) = decode_registry_any(text.as_bytes()).unwrap();
            assert!(secrets.is_empty() && !doc.entries[0].has_password);
            assert_eq!(doc.entries[0].unknown.get("password"), Some(&Value::from("P")));
        }
    }
}
