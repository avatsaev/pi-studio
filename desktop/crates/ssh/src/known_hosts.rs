//! Host keys: classing a server key against `~/.ssh/known_hosts` and the app's own file, and trusting a
//! new key (`swe/features/desktop-relay-ssh.md` § 7, D13, S15).
//!
//! The lookup is written here rather than taken from russh's helpers: those fail the whole check on one
//! malformed line, ignore `@revoked`, wildcards and negations, and compare host names case-sensitively. A
//! known-hosts file is user-edited and may carry anything, so a line that does not parse is skipped.
//!
//! Only [`trust`] writes, and only to the file it is handed (the app's); `~/.ssh/known_hosts` is read
//! through [`check`] and never written (S15).

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::str::FromStr;

use ring::hmac;
use russh::keys::ssh_key::known_hosts::{Entry, HostPatterns, Marker};
use russh::keys::{HashAlg, PublicKey};

/// The port whose entries carry the bare host name; every other port is written `[host]:port`.
const DEFAULT_SSH_PORT: u16 = 22;
/// The largest known-hosts file read; a larger one is read up to here and the rest ignored.
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
/// The longest line parsed; a longer one is skipped as malformed (a 16384-bit RSA key line is ~4 KiB).
const MAX_LINE_BYTES: usize = 16 * 1024;
/// File mode of the app's known-hosts file.
#[cfg(unix)]
const FILE_MODE: u32 = 0o600;

/// What the files say about a server's host key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostKeyStatus {
    /// An entry for this host holds this very key.
    Known,
    /// No entry for this host holds a key of this type (or the host has none at all).
    Unknown,
    /// An entry for this host holds a different key of the same type, or the key is marked `@revoked`.
    Changed,
}

/// Why a known-hosts file could not be read or written.
#[derive(Debug, thiserror::Error)]
pub enum KnownHostsError {
    /// The file could not be read, or the app's file could not be created or appended to.
    #[error("known hosts file: {0}")]
    Io(#[from] io::Error),
    /// The host cannot be written as a known-hosts name (empty, or holding whitespace, a control
    /// character, `,`, a wildcard, `!`, `#` or a bracket, or starting with `|` or `@`).
    #[error("host name cannot be stored in known hosts")]
    InvalidHost,
    /// The key could not be written in OpenSSH form.
    #[error("host key encoding: {0}")]
    Encode(#[from] russh::keys::ssh_key::Error),
}

/// Class `key`, offered by `host:port`, against `files`, read in order; a file that does not exist is
/// skipped.
///
/// [`Known`](HostKeyStatus::Known) when any entry holds the key and none revokes it. Otherwise
/// [`Changed`](HostKeyStatus::Changed) when an entry for the host holds another key of the same type.
/// Otherwise [`Unknown`](HostKeyStatus::Unknown), including a host known only by keys of other types.
/// Entries match by plain name, `[host]:port`, hashed `|1|` name, `*`/`?` pattern and `!` negation;
/// `@cert-authority` entries are ignored.
pub fn check(host: &str, port: u16, key: &PublicKey, files: &[&Path]) -> Result<HostKeyStatus, KnownHostsError> {
    let name = host_name(host, port);
    let mut known = false;
    let mut changed = false;
    for file in files {
        let Some(text) = read_file(file)? else {
            continue;
        };
        for line in text.lines() {
            let Some(entry) = parse_line(line) else {
                continue;
            };
            if !matches_host(entry.host_patterns(), &name) {
                continue;
            }
            let recorded = entry.public_key();
            let same_key = recorded.key_data() == key.key_data();
            match entry.marker() {
                Some(Marker::Revoked) if same_key => return Ok(HostKeyStatus::Changed),
                Some(Marker::CertAuthority | Marker::Revoked) => {}
                None if same_key => known = true,
                None => changed |= recorded.algorithm() == key.algorithm(),
            }
        }
    }
    Ok(match (known, changed) {
        (true, _) => HostKeyStatus::Known,
        (false, true) => HostKeyStatus::Changed,
        (false, false) => HostKeyStatus::Unknown,
    })
}

/// A server key as a person is shown it before trusting it: the key type and the SHA-256 fingerprint, as `ssh` prints
/// them (`ssh-ed25519`, `SHA256:...`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyDescription {
    pub algorithm: String,
    pub fingerprint: String,
}

/// The key type and SHA-256 fingerprint of `key`.
#[must_use]
pub fn describe(key: &PublicKey) -> KeyDescription {
    KeyDescription { algorithm: key.algorithm().to_string(), fingerprint: key.fingerprint(HashAlg::Sha256).to_string() }
}

/// Append `key` for `host:port` to `app_file` as one OpenSSH line, creating the file (mode 0600 on Unix)
/// and its directory. A file not ending in a newline gets one first.
pub fn trust(host: &str, port: u16, key: &PublicKey, app_file: &Path) -> Result<(), KnownHostsError> {
    if !is_storable_host(host) {
        return Err(KnownHostsError::InvalidHost);
    }
    let key_text = PublicKey::from(key.key_data().clone()).to_openssh()?;
    if let Some(parent) = app_file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut options = OpenOptions::new();
    options.read(true).append(true).create(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, FILE_MODE);
    let mut file = options.open(app_file)?;

    let mut line = String::new();
    if !ends_in_newline(&mut file)? {
        line.push('\n');
    }
    line.push_str(&host_name(host, port));
    line.push(' ');
    line.push_str(&key_text);
    line.push('\n');
    // One write on an append-mode handle: a concurrent writer cannot interleave inside the line.
    file.write_all(line.as_bytes())?;
    Ok(())
}

/// The name an entry is matched against: the lowercased host, wrapped `[host]:port` off port 22.
fn host_name(host: &str, port: u16) -> String {
    let host = host.to_ascii_lowercase();
    if port == DEFAULT_SSH_PORT { host } else { format!("[{host}]:{port}") }
}

fn is_storable_host(host: &str) -> bool {
    !host.is_empty()
        && !host.starts_with(['|', '@'])
        && !host.chars().any(|c| c.is_whitespace() || c.is_control() || matches!(c, ',' | '*' | '?' | '!' | '#' | '[' | ']'))
}

/// The file as text, `None` when it does not exist. Invalid UTF-8 is replaced, not refused.
fn read_file(path: &Path) -> io::Result<Option<String>> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES).read_to_end(&mut bytes)?;
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

fn ends_in_newline(file: &mut File) -> io::Result<bool> {
    if file.metadata()?.len() == 0 {
        return Ok(true);
    }
    file.seek(SeekFrom::End(-1))?;
    let mut last = [0u8; 1];
    file.read_exact(&mut last)?;
    Ok(last[0] == b'\n')
}

/// One line as an entry; `None` for a blank line, a comment, an over-long line or one that is malformed.
fn parse_line(line: &str) -> Option<Entry> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') || line.len() > MAX_LINE_BYTES {
        return None;
    }
    Entry::from_str(line).ok()
}

fn matches_host(patterns: &HostPatterns, name: &str) -> bool {
    match patterns {
        HostPatterns::HashedName { salt, hash } => {
            let key = hmac::Key::new(hmac::HMAC_SHA1_FOR_LEGACY_USE_ONLY, salt);
            hmac::verify(&key, name.as_bytes(), hash).is_ok()
        }
        HostPatterns::Patterns(list) => {
            let mut matched = false;
            for pattern in list {
                if let Some(negated) = pattern.strip_prefix('!') {
                    if glob(negated.to_ascii_lowercase().as_bytes(), name.as_bytes()) {
                        return false;
                    }
                } else {
                    matched |= glob(pattern.to_ascii_lowercase().as_bytes(), name.as_bytes());
                }
            }
            matched
        }
    }
}

/// `*` (any run) and `?` (one byte) matching, in linear space and `O(pattern * text)` time: no input
/// makes it backtrack exponentially.
fn glob(pattern: &[u8], text: &[u8]) -> bool {
    let (mut p, mut t) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while t < text.len() {
        match pattern.get(p) {
            Some(b'*') => {
                star = Some((p, t));
                p += 1;
            }
            Some(&c) if c == b'?' || c == text[t] => {
                p += 1;
                t += 1;
            }
            _ => match star {
                Some((star_p, star_t)) => {
                    p = star_p + 1;
                    t = star_t + 1;
                    star = Some((star_p, star_t + 1));
                }
                None => return false,
            },
        }
    }
    pattern[p..].iter().all(|&c| c == b'*')
}

#[cfg(test)]
mod tests;
