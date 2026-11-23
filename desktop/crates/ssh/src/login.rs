//! Logging in to one host, in OpenSSH's order (D11, S13): the agent's identities (unless `IdentitiesOnly`), then key
//! files (the entry's, the config's, then `~/.ssh/id_ed25519`, `id_ecdsa`, `id_rsa`), then the stored password.
//!
//! * At most [`MAX_ATTEMPTS`] attempts per host, each identity and the password counting one.
//! * The password is offered to the final host only: a jump host is never given it.
//! * An encrypted key is opened with the stored passphrase. Without one (or with a wrong one) the key is skipped and
//!   remembered, and when nothing else logs in the connect fails with `passphrase_needed`; a key file the entry or the
//!   config names that is missing or unreadable is remembered the same way for `key_unreadable`. A default key file that
//!   is missing or unreadable is skipped without a word.
//! * A method the server's last refusal did not list is not tried.
//!
//! Nothing here logs or returns a secret: the error names key files by file name and lists methods, not values.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use russh::client;
use russh::client::AuthResult;
use russh::client::Handle;
use russh::keys::agent::AgentIdentity;
use russh::keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg, decode_secret_key};
use russh::{MethodKind, MethodSet};

use crate::agent;
use crate::config::{Target, default_identity_files};
use crate::error::{Error, Tried};
use crate::session::{Deadline, Environment};

/// Most login attempts per host.
pub const MAX_ATTEMPTS: usize = 6;
/// The largest key file read; a larger one is unreadable (a 16384-bit RSA key with a passphrase is under 16 KiB).
const MAX_KEY_BYTES: u64 = 256 * 1024;

/// The secrets a login may use, from the secret store. Debug shows which are present, never a value.
#[derive(Clone, Default)]
pub struct Secrets {
    /// The SSH account's password, offered to the final host only.
    pub password: Option<String>,
    /// The passphrase of the entry's key file (tried on any encrypted key file).
    pub passphrase: Option<String>,
}

impl std::fmt::Debug for Secrets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Secrets").field("password", &self.password.is_some()).field("passphrase", &self.passphrase.is_some()).finish()
    }
}

/// What reading a key file gave.
enum Loaded {
    Key(Box<PrivateKey>),
    /// There is no such file.
    Missing,
    /// The file is not a key the library reads, or could not be read.
    Unreadable,
    /// The key is encrypted and the passphrase is absent or wrong.
    NeedsPassphrase,
}

/// A key file to try and whether the entry or config named it (a default is skipped quietly when it fails).
struct Candidate {
    path: PathBuf,
    explicit: bool,
}

/// One host's login: the state of the attempts so far.
struct Login<'a> {
    target: &'a Target,
    secrets: &'a Secrets,
    env: &'a Environment,
    deadline: &'a Deadline,
    hop: usize,
    is_final: bool,
    used: usize,
    tried: Vec<Tried>,
    /// The methods the server's last refusal listed.
    remaining: Option<MethodSet>,
    rsa_hash: Option<Option<HashAlg>>,
    /// The first explicit key file that was missing or unreadable, by file name.
    unreadable: Option<String>,
    /// The first key file that needed a passphrase, by file name.
    needs_passphrase: Option<String>,
}

/// Logs in to the host `handle` is connected to as `target.user`.
///
/// # Errors
/// [`Error::KeyUnreadable`], [`Error::PassphraseNeeded`] or [`Error::AuthFailed`] when every attempt failed (in that
/// order of precedence), [`Error::Timeout`] when a step ran out, [`Error::Handshake`] when the connection ended.
pub(crate) async fn login<H: client::Handler>(
    handle: &mut Handle<H>,
    target: &Target,
    secrets: &Secrets,
    env: &Environment,
    deadline: &Deadline,
    hop: usize,
    is_final: bool,
) -> Result<(), Error> {
    let mut login = Login {
        target,
        secrets,
        env,
        deadline,
        hop,
        is_final,
        used: 0,
        tried: Vec::new(),
        remaining: None,
        rsa_hash: None,
        unreadable: None,
        needs_passphrase: None,
    };
    if login.agent(handle).await? || login.key_files(handle).await? || login.password(handle).await? {
        return Ok(());
    }
    if handle.is_closed() {
        return Err(Error::Handshake { hop });
    }
    Err(login.failure())
}

impl Login<'_> {
    /// Whether another attempt with `kind` may be made: the limit is not reached and the server did not exclude it.
    fn allowed(&self, kind: MethodKind) -> bool {
        self.used < MAX_ATTEMPTS && self.remaining.as_ref().is_none_or(|methods| methods.is_empty() || methods.contains(&kind))
    }

    /// Runs one attempt and reports whether it logged in. An attempt that failed for any reason is `false`; only a step
    /// that ran out of time is an error.
    async fn attempt<E>(&mut self, outcome: impl Future<Output = Result<AuthResult, E>>) -> Result<bool, Error> {
        self.used += 1;
        match self.deadline.run(self.hop, outcome).await? {
            Ok(AuthResult::Success) => Ok(true),
            Ok(AuthResult::Failure { remaining_methods, .. }) => {
                self.remaining = Some(remaining_methods);
                Ok(false)
            }
            Err(_) => Ok(false),
        }
    }

    /// The hash an RSA key signs with: the best the server accepts, asked once.
    async fn hash_for<H: client::Handler>(&mut self, handle: &Handle<H>, is_rsa: bool) -> Result<Option<HashAlg>, Error> {
        if !is_rsa {
            return Ok(None);
        }
        if let Some(hash) = self.rsa_hash {
            return Ok(hash);
        }
        let asked = self.deadline.run(self.hop, handle.best_supported_rsa_hash()).await?;
        let hash = asked.ok().flatten().flatten();
        self.rsa_hash = Some(hash);
        Ok(hash)
    }

    /// The agent's identities, in the agent's order.
    async fn agent<H: client::Handler>(&mut self, handle: &mut Handle<H>) -> Result<bool, Error> {
        if self.target.identities_only || !self.allowed(MethodKind::PublicKey) {
            return Ok(false);
        }
        let (target, env) = (self.target, self.env);
        let asked = self
            .deadline
            .run(self.hop, async {
                let mut client = agent::connect(&target.agent, env).await?;
                let identities = client.request_identities().await.ok()?;
                Some((client, identities))
            })
            .await?;
        let Some((mut client, identities)) = asked else {
            return Ok(false);
        };
        for identity in identities {
            let AgentIdentity::PublicKey { key, .. } = identity else {
                continue;
            };
            if !self.allowed(MethodKind::PublicKey) {
                break;
            }
            if !self.tried.contains(&Tried::Agent) {
                self.tried.push(Tried::Agent);
            }
            let hash = self.hash_for(handle, key.algorithm().is_rsa()).await?;
            let outcome = handle.authenticate_publickey_with(self.target.user.as_str(), key, hash, &mut client);
            if self.attempt(outcome).await? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// The key files: the entry's and the config's, then the defaults that exist.
    async fn key_files<H: client::Handler>(&mut self, handle: &mut Handle<H>) -> Result<bool, Error> {
        for candidate in self.candidates() {
            if !self.allowed(MethodKind::PublicKey) {
                break;
            }
            let name = file_name(&candidate.path);
            match read_key(candidate.path, self.secrets.passphrase.clone()).await {
                Loaded::Key(key) => {
                    self.tried.push(Tried::KeyFile(name));
                    let hash = self.hash_for(handle, key.algorithm().is_rsa()).await?;
                    let outcome = handle.authenticate_publickey(self.target.user.as_str(), PrivateKeyWithHashAlg::new(Arc::new(*key), hash));
                    if self.attempt(outcome).await? {
                        return Ok(true);
                    }
                }
                Loaded::NeedsPassphrase => {
                    self.needs_passphrase.get_or_insert(name);
                }
                Loaded::Missing | Loaded::Unreadable if candidate.explicit => {
                    self.unreadable.get_or_insert(name);
                }
                Loaded::Missing | Loaded::Unreadable => {}
            }
        }
        Ok(false)
    }

    /// The stored password, on the final host only.
    async fn password<H: client::Handler>(&mut self, handle: &mut Handle<H>) -> Result<bool, Error> {
        let secrets = self.secrets;
        let Some(password) = secrets.password.as_ref().filter(|_| self.is_final) else {
            return Ok(false);
        };
        if !self.allowed(MethodKind::Password) {
            return Ok(false);
        }
        self.tried.push(Tried::Password);
        let outcome = handle.authenticate_password(self.target.user.as_str(), password.as_str());
        self.attempt(outcome).await
    }

    /// The key files to try, in order: the explicit ones, then each default that is not already one.
    fn candidates(&self) -> Vec<Candidate> {
        let explicit = &self.target.identity_files;
        let defaults = default_identity_files(&self.env.home).into_iter().filter(|path| !explicit.contains(path));
        explicit.iter().map(|path| Candidate { path: path.clone(), explicit: true }).chain(defaults.map(|path| Candidate { path, explicit: false })).collect()
    }

    /// Why nothing logged in.
    fn failure(self) -> Error {
        let hop = self.hop;
        match (self.unreadable, self.needs_passphrase) {
            (Some(file), _) => Error::KeyUnreadable { hop, file },
            (None, Some(file)) => Error::PassphraseNeeded { hop, file },
            (None, None) => Error::AuthFailed { hop, tried: self.tried },
        }
    }
}

/// The file's name, for a message: never its directory.
fn file_name(path: &Path) -> String {
    path.file_name().map_or_else(String::new, |name| name.to_string_lossy().into_owned())
}

/// Reads and decrypts a key file on a blocking thread.
async fn read_key(path: PathBuf, passphrase: Option<String>) -> Loaded {
    tokio::task::spawn_blocking(move || load_key(&path, passphrase.as_deref())).await.unwrap_or(Loaded::Unreadable)
}

/// The key file as a private key. A file over [`MAX_KEY_BYTES`] is read no further and is unreadable.
fn load_key(path: &Path, passphrase: Option<&str>) -> Loaded {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Loaded::Missing,
        Err(_) => return Loaded::Unreadable,
    };
    let mut text = String::new();
    if file.take(MAX_KEY_BYTES + 1).read_to_string(&mut text).is_err() || text.len() as u64 > MAX_KEY_BYTES {
        return Loaded::Unreadable;
    }
    match decode_secret_key(&text, None) {
        Ok(key) => Loaded::Key(Box::new(key)),
        Err(russh::keys::Error::KeyIsEncrypted) => match passphrase.map(|passphrase| decode_secret_key(&text, Some(passphrase))) {
            Some(Ok(key)) => Loaded::Key(Box::new(key)),
            _ => Loaded::NeedsPassphrase,
        },
        Err(_) => Loaded::Unreadable,
    }
}

#[cfg(test)]
mod tests;
