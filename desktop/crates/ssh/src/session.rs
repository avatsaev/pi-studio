//! Opening an SSH connection through any jump hosts, and the session that keeps it (`swe/features/desktop-relay-ssh.md`
//! § 7).
//!
//! [`connect`] dials the first host, checks its host key, logs in ([`crate::login`]), and for each further host opens a
//! `direct-tcpip` channel to it over the previous one and runs the same SSH handshake over that channel. Every network
//! step is limited to [`Limits::step`] and the whole connect to [`Limits::total`]. The session keeps every hop's
//! connection: dropping a hop's handle ends it, and with it the connections beyond.
//!
//! russh sends the keepalive itself: a request every [`Limits::keepalive_interval`] of silence, and the connection ends
//! when [`Limits::keepalive_max`] of them were not answered. A connection that ended for any reason, that one included,
//! shows in [`Session::is_closed`] and wakes [`Session::closed`].

use std::borrow::Cow;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use russh::keys::PublicKey;
use russh::{ChannelOpenFailure, ChannelStream, Disconnect, Preferred, client, mac};
use tokio::net::TcpStream;
use tokio::sync::Notify;
use tokio::time::{Instant, timeout};

use crate::config::Target;
use crate::error::Error;
use crate::known_hosts::{HostKeyStatus, check};
use crate::login::{Secrets, login};

/// One step over the network: a dial, a handshake, one login attempt, a channel open.
pub const STEP_LIMIT: Duration = Duration::from_secs(15);
/// The whole connect, however many hops it has.
pub const TOTAL_LIMIT: Duration = Duration::from_secs(45);
/// Silence after which a keepalive request is sent.
pub const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);
/// Unanswered keepalives after which the connection ends.
pub const KEEPALIVE_MAX: usize = 3;
/// The receive window of every channel, in bytes. russh's default is 2 MiB, and about half of it is in flight at a time:
/// a save over a 40 ms round trip ran at 25 MiB/s with it and at about 60 MiB/s with 8 MiB; 16 MiB gained nothing more
/// (`desktop/docs/platform-checks.md` § Milestone 4, transfers). With 8 MiB the app's memory still did not grow with
/// the size of a transfer (4 GiB against 1 GiB: at most 8.3 MiB more).
pub const CHANNEL_WINDOW: u32 = 8 * 1024 * 1024;
/// The originator address of a `direct-tcpip` channel: this machine, no port.
const ORIGINATOR: (&str, u32) = ("127.0.0.1", 0);

/// The time limits of a connection; a test shortens one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    /// The most one network step may take.
    pub step: Duration,
    /// The most a whole connect may take.
    pub total: Duration,
    /// Silence after which a keepalive request is sent.
    pub keepalive_interval: Duration,
    /// Unanswered keepalives after which the connection ends.
    pub keepalive_max: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self { step: STEP_LIMIT, total: TOTAL_LIMIT, keepalive_interval: KEEPALIVE_INTERVAL, keepalive_max: KEEPALIVE_MAX }
    }
}

/// What the connect reads from this machine and its login shell: the home directory (for `~` and the default key
/// files) and the environment the agent's socket is named in (`SSH_AUTH_SOCK`, or the variable an `IdentityAgent` names).
#[derive(Clone, Debug, Default)]
pub struct Environment {
    pub home: PathBuf,
    pub vars: HashMap<String, OsString>,
}

/// Time left for the connect and for each step of it.
pub(crate) struct Deadline {
    at: Instant,
    step: Duration,
}

impl Deadline {
    fn new(limits: &Limits) -> Self {
        Self { at: Instant::now() + limits.total, step: limits.step }
    }

    /// Runs `future` for at most one step and never past the end of the connect; `hop` names the host in the error.
    pub(crate) async fn run<T>(&self, hop: usize, future: impl Future<Output = T>) -> Result<T, Error> {
        let left = self.at.saturating_duration_since(Instant::now());
        timeout(left.min(self.step), future).await.map_err(|_| Error::Timeout { hop })
    }
}

/// Set when any connection of a session ends: the handler of every hop holds one, and its drop (the session task ending,
/// however it ended) marks it.
#[derive(Default)]
struct Closed {
    flag: AtomicBool,
    notify: Notify,
}

impl Closed {
    fn mark(&self) {
        self.flag.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    fn is_set(&self) -> bool {
        self.flag.load(Ordering::Acquire)
    }

    async fn wait(&self) {
        loop {
            let notified = self.notify.notified();
            if self.is_set() {
                return;
            }
            notified.await;
        }
    }
}

/// What the host-key check decided, when it refused: the connect turns it into the error with the code.
enum Verdict {
    Unknown(PublicKey),
    Changed,
    Unreadable,
}

/// The shared slot a handler leaves its verdict in; russh itself only says that the key was refused.
type VerdictSlot = Arc<Mutex<Option<Verdict>>>;

/// Judges one host's key against the known-hosts files and notes when its connection ends.
struct Handler {
    host: String,
    port: u16,
    files: Arc<Vec<PathBuf>>,
    verdict: VerdictSlot,
    closed: Arc<Closed>,
}

impl Drop for Handler {
    fn drop(&mut self) {
        self.closed.mark();
    }
}

impl Handler {
    fn refuse(&self, verdict: Verdict) {
        *self.verdict.lock().unwrap_or_else(PoisonError::into_inner) = Some(verdict);
    }
}

impl client::Handler for Handler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &russh::keys::PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let key = match key {
            russh::keys::PublicKeyOrCertificate::PublicKey { key, .. } => key.clone(),
            russh::keys::PublicKeyOrCertificate::Certificate(certificate) => PublicKey::new(certificate.public_key().clone(), ""),
        };
        let (host, port, files, offered) = (self.host.clone(), self.port, Arc::clone(&self.files), key.clone());
        // The files are read synchronously by `known_hosts`, and a known-hosts file may be large.
        let status = tokio::task::spawn_blocking(move || {
            let paths: Vec<&Path> = files.iter().map(PathBuf::as_path).collect();
            check(&host, port, &offered, &paths)
        })
        .await;
        match status {
            Ok(Ok(HostKeyStatus::Known)) => Ok(true),
            Ok(Ok(HostKeyStatus::Unknown)) => {
                self.refuse(Verdict::Unknown(key));
                Ok(false)
            }
            Ok(Ok(HostKeyStatus::Changed)) => {
                self.refuse(Verdict::Changed);
                Ok(false)
            }
            Ok(Err(_)) | Err(_) => {
                self.refuse(Verdict::Unreadable);
                Ok(false)
            }
        }
    }
}

/// An open SSH connection to the final host, through its jump hosts.
pub struct Session {
    jump: Vec<client::Handle<Handler>>,
    host: client::Handle<Handler>,
    closed: Arc<Closed>,
    limits: Limits,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session").field("hops", &self.jump.len()).field("closed", &self.is_closed()).finish()
    }
}

impl Session {
    /// How many jump hosts the connection runs through.
    #[must_use]
    pub fn hops(&self) -> usize {
        self.jump.len()
    }

    /// Whether any connection of the chain has ended (a keepalive that failed, a disconnect, a dropped socket).
    #[must_use]
    pub fn is_closed(&self) -> bool {
        self.closed.is_set() || self.host.is_closed() || self.jump.iter().any(client::Handle::is_closed)
    }

    /// Resolves when any connection of the chain ends.
    pub async fn closed(&self) {
        self.closed.wait().await;
    }

    /// Opens a `direct-tcpip` channel from the final host to `host:port` as a byte stream, within one step.
    ///
    /// # Errors
    /// [`Error::ForwardingRefused`] when the server's rules forbid it, [`Error::PortRefused`] when the connection to
    /// the port was refused, [`Error::Timeout`] after a step, [`Error::Lost`] when the connection is gone.
    pub async fn open_tcpip(&self, host: &str, port: u16) -> Result<ChannelStream<client::Msg>, Error> {
        let hop = self.jump.len();
        let open = self.host.channel_open_direct_tcpip(host, u32::from(port), ORIGINATOR.0, ORIGINATOR.1);
        let channel = timeout(self.limits.step, open).await.map_err(|_| Error::Timeout { hop })?.map_err(|error| channel_error(&error, hop))?;
        Ok(channel.into_stream())
    }

    /// Ends the connections, the final host's first.
    pub async fn close(self) {
        let _ = self.host.disconnect(Disconnect::ByApplication, "", "en").await;
        for handle in self.jump.iter().rev() {
            let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        }
    }
}

/// What a refused or failed channel open means.
fn channel_error(error: &russh::Error, hop: usize) -> Error {
    match error {
        russh::Error::ChannelOpenFailure(ChannelOpenFailure::AdministrativelyProhibited) => Error::ForwardingRefused { hop },
        russh::Error::ChannelOpenFailure(ChannelOpenFailure::ConnectFailed) => Error::PortRefused { hop },
        _ => Error::Lost { hop },
    }
}

/// The MACs a connect offers: russh's SHA-2 ones in its order, then the SHA-1 ones. A server takes the first of these
/// that it also offers, so SHA-1 is used only with a host that offers nothing else (old devices); and only when the
/// negotiated cipher needs a MAC at all, which the AEAD ciphers (ChaCha20-Poly1305, AES-GCM) do not.
const MACS: &[mac::Name] = &[mac::HMAC_SHA512_ETM, mac::HMAC_SHA256_ETM, mac::HMAC_SHA512, mac::HMAC_SHA256, mac::HMAC_SHA1_ETM, mac::HMAC_SHA1];

/// russh's client settings for every hop: our keepalive, no Nagle delay, a [`CHANNEL_WINDOW`] window, and [`MACS`].
fn client_config(limits: &Limits) -> Arc<client::Config> {
    Arc::new(client::Config {
        keepalive_interval: Some(limits.keepalive_interval),
        keepalive_max: limits.keepalive_max,
        nodelay: true,
        window_size: CHANNEL_WINDOW,
        preferred: Preferred { mac: Cow::Borrowed(MACS), ..Preferred::DEFAULT },
        ..client::Config::default()
    })
}

/// Opens the connection to `target`'s final host through its `hops`, logging in at each, with `known_hosts` read in
/// order (`~/.ssh/known_hosts`, then the app's own file).
///
/// The stored password is offered to the final host only; a jump host is logged in to with the agent and key files.
///
/// # Errors
/// An [`Error`] naming the failing host by `hop` (0 is the first connection, the last index the final host).
pub async fn connect(target: &Target, secrets: &Secrets, env: &Environment, known_hosts: &[PathBuf], limits: &Limits) -> Result<Session, Error> {
    let deadline = Deadline::new(limits);
    let closed = Arc::new(Closed::default());
    let files = Arc::new(known_hosts.to_vec());
    let chain: Vec<&Target> = target.hops.iter().chain(std::iter::once(target)).collect();
    let mut handles: Vec<client::Handle<Handler>> = Vec::with_capacity(chain.len());
    for (hop, next) in chain.iter().enumerate() {
        let verdict = VerdictSlot::default();
        let handler =
            Handler { host: next.host.clone(), port: next.port, files: Arc::clone(&files), verdict: Arc::clone(&verdict), closed: Arc::clone(&closed) };
        let config = client_config(limits);
        let mut handle = match handles.last() {
            None => {
                let stream = dial(next, &deadline, hop).await?;
                handshake(config, stream, handler, &verdict, &deadline, hop).await?
            }
            Some(previous) => {
                let stream = open_hop(previous, next, &deadline, hop).await?;
                handshake(config, stream, handler, &verdict, &deadline, hop).await?
            }
        };
        login(&mut handle, next, secrets, env, &deadline, hop, hop + 1 == chain.len()).await?;
        handles.push(handle);
    }
    let host = handles.pop().ok_or(Error::Lost { hop: 0 })?;
    Ok(Session { jump: handles, host, closed, limits: *limits })
}

/// The TCP connection to the first host.
async fn dial(target: &Target, deadline: &Deadline, hop: usize) -> Result<TcpStream, Error> {
    let stream = deadline.run(hop, TcpStream::connect((target.host.as_str(), target.port))).await?.map_err(|_| Error::Unreachable { hop })?;
    // A failure here only costs the keystroke latency Nagle's algorithm adds.
    let _ = stream.set_nodelay(true);
    Ok(stream)
}

/// The channel to the next host over the previous hop's connection.
async fn open_hop(previous: &client::Handle<Handler>, next: &Target, deadline: &Deadline, hop: usize) -> Result<ChannelStream<client::Msg>, Error> {
    let open = previous.channel_open_direct_tcpip(next.host.as_str(), u32::from(next.port), ORIGINATOR.0, ORIGINATOR.1);
    match deadline.run(hop, open).await? {
        Ok(channel) => Ok(channel.into_stream()),
        Err(error) => Err(match channel_error(&error, hop - 1) {
            // The previous hop could not reach the next: that is the next host being unreachable.
            Error::PortRefused { .. } => Error::Unreachable { hop },
            other => other,
        }),
    }
}

/// The SSH handshake over `stream`, with the host-key check; a refused key becomes its error.
async fn handshake<R>(
    config: Arc<client::Config>,
    stream: R,
    handler: Handler,
    verdict: &VerdictSlot,
    deadline: &Deadline,
    hop: usize,
) -> Result<client::Handle<Handler>, Error>
where
    R: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (host, port) = (handler.host.clone(), handler.port);
    match deadline.run(hop, client::connect_stream(config, stream, handler)).await? {
        Ok(handle) => Ok(handle),
        Err(_) => Err(match verdict.lock().unwrap_or_else(PoisonError::into_inner).take() {
            Some(Verdict::Unknown(key)) => Error::HostKeyUnknown { hop, host, port, key: Box::new(key) },
            Some(Verdict::Changed) => Error::HostKeyChanged { hop, host, port },
            Some(Verdict::Unreadable) => Error::KnownHosts { hop },
            None => Error::Handshake { hop },
        }),
    }
}

mod channels;

#[cfg(test)]
mod tests;
